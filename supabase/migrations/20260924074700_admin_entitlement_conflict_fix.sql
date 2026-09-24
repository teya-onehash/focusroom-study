-- Disambiguate the entitlement primary-key conflict target from RPC output names.

create or replace function public.admin_set_entitlement(
  p_user_id uuid,
  p_tier text default null,
  p_expires_at timestamptz default null,
  p_reason text default 'Owner-granted access'
)
returns table (
  user_id uuid,
  current_plan text,
  entitlement_tier text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  target_role text;
  clean_reason text := left(trim(coalesce(p_reason, 'Owner-granted access')), 200);
begin
  caller_role := private.admin_role(caller);
  if caller is null or caller_role is distinct from 'owner' then
    raise exception 'Owner access required';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Member not found';
  end if;

  target_role := private.admin_role(p_user_id);
  if target_role is not null and p_user_id <> caller then
    raise exception 'Admin plans are managed by their role';
  end if;

  if p_tier is null or p_tier = 'free' then
    delete from private.complimentary_entitlements e where e.user_id = p_user_id;
  else
    if p_tier not in ('basic', 'premium', 'buddy') then
      raise exception 'Invalid complimentary plan';
    end if;
    if p_expires_at is not null and p_expires_at <= now() then
      raise exception 'Expiry must be in the future';
    end if;
    if char_length(clean_reason) < 3 then
      raise exception 'A short reason is required';
    end if;

    insert into private.complimentary_entitlements (
      user_id, tier, reason, expires_at, granted_by
    ) values (
      p_user_id, p_tier, clean_reason, p_expires_at, caller
    )
    on conflict on constraint complimentary_entitlements_pkey do update set
      tier = excluded.tier,
      reason = excluded.reason,
      expires_at = excluded.expires_at,
      granted_by = excluded.granted_by,
      updated_at = now();
  end if;

  insert into private.admin_audit_log (actor_id, action, target_user_id, details)
  values (
    caller,
    'set_complimentary_plan',
    p_user_id,
    jsonb_build_object(
      'tier', coalesce(p_tier, 'free'),
      'expires_at', p_expires_at,
      'reason', clean_reason
    )
  );

  return query
  select
    p_user_id,
    private.current_plan(p_user_id),
    e.tier
  from (select 1) seed
  left join private.complimentary_entitlements e on e.user_id = p_user_id;
end;
$$;

revoke all on function public.admin_set_entitlement(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_set_entitlement(uuid, text, timestamptz, text) to authenticated;
