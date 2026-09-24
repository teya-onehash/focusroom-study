-- FocusRoom owner/admin access, complimentary plans, and moderation controls.
-- Admin membership and grants live outside the exposed Data API schema.

create table if not exists private.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists private.complimentary_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null check (tier in ('basic', 'premium', 'buddy')),
  reason text not null default 'Owner-granted access'
    check (char_length(reason) between 3 and 200),
  expires_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

create table if not exists private.report_moderation (
  report_id uuid primary key references public.user_reports(id) on delete cascade,
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);

create table if not exists private.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 3 and 80),
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table private.app_admins enable row level security;
alter table private.complimentary_entitlements enable row level security;
alter table private.report_moderation enable row level security;
alter table private.admin_audit_log enable row level security;

revoke all on table private.app_admins from public, anon, authenticated;
revoke all on table private.complimentary_entitlements from public, anon, authenticated;
revoke all on table private.report_moderation from public, anon, authenticated;
revoke all on table private.admin_audit_log from public, anon, authenticated;
revoke all on sequence private.admin_audit_log_id_seq from public, anon, authenticated;

create index if not exists complimentary_entitlements_expiry_idx
  on private.complimentary_entitlements (expires_at)
  where expires_at is not null;

create index if not exists admin_audit_log_created_idx
  on private.admin_audit_log (created_at desc);

create index if not exists user_reports_status_created_idx
  on public.user_reports (status, created_at desc);

create or replace function private.admin_role(check_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from private.app_admins a
  where a.user_id = check_user_id
  limit 1;
$$;

create or replace function private.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_role(check_user_id) in ('owner', 'admin');
$$;

create or replace function private.current_plan(check_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select candidate.tier
    from (
      select 'premium'::text as tier, 20 as priority
      where private.is_admin(check_user_id)

      union all

      select e.tier,
        case e.tier when 'buddy' then 30 when 'premium' then 20 else 10 end
      from private.complimentary_entitlements e
      where e.user_id = check_user_id
        and (e.expires_at is null or e.expires_at > now())

      union all

      select case when s.tier = 'plus' then 'premium' else s.tier end,
        case s.tier when 'buddy' then 30 when 'premium' then 20 when 'plus' then 20 else 10 end
      from public.subscriptions s
      where s.user_id = check_user_id
        and s.status in ('trialing', 'active')
        and (s.current_period_end is null or s.current_period_end > now())
    ) candidate
    order by candidate.priority desc
    limit 1
  ), 'free');
$$;

revoke all on function private.admin_role(uuid) from public, anon, authenticated;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;
revoke all on function private.current_plan(uuid) from public, anon, authenticated;

create or replace function public.get_admin_access()
returns table (
  role text,
  is_admin boolean,
  plan text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    private.admin_role(caller),
    private.is_admin(caller),
    private.current_plan(caller);
end;
$$;

create or replace function public.get_admin_dashboard()
returns table (
  members_total bigint,
  premium_members bigint,
  active_rooms bigint,
  open_reports bigint,
  messages_today bigint,
  calls_today bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    (select count(*) from auth.users),
    (select count(*) from auth.users u where private.current_plan(u.id) in ('premium', 'buddy')),
    (select count(*) from public.rooms r where r.active),
    (select count(*) from public.user_reports ur where ur.status in ('open', 'reviewing')),
    (select count(*) from public.dm_messages m where m.created_at >= date_trunc('day', now())),
    (select count(*) from public.dm_calls c where c.created_at >= date_trunc('day', now()));
end;
$$;

create or replace function public.admin_list_members(
  p_search text default '',
  p_limit integer default 50
)
returns table (
  id uuid,
  display_name text,
  email text,
  subject text,
  avatar_color text,
  avatar_path text,
  app_role text,
  current_plan text,
  entitlement_tier text,
  entitlement_expires_at timestamptz,
  joined_at timestamptz,
  report_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  search_term text := left(trim(coalesce(p_search, '')), 100);
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    u.id,
    coalesce(p.display_name, split_part(u.email, '@', 1)),
    u.email::text,
    coalesce(p.subject, ''),
    coalesce(p.avatar_color, '#7c6cff'),
    p.avatar_path,
    private.admin_role(u.id),
    private.current_plan(u.id),
    e.tier,
    e.expires_at,
    u.created_at,
    (select count(*) from public.user_reports ur where ur.reported_user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join private.complimentary_entitlements e
    on e.user_id = u.id
   and (e.expires_at is null or e.expires_at > now())
  where search_term = ''
     or coalesce(p.display_name, '') ilike '%' || search_term || '%'
     or coalesce(u.email, '') ilike '%' || search_term || '%'
  order by
    case private.admin_role(u.id) when 'owner' then 0 when 'admin' then 1 else 2 end,
    u.created_at desc
  limit row_limit;
end;
$$;

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
  if caller is null or caller_role <> 'owner' then
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
    on conflict (user_id) do update set
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

create or replace function public.admin_list_reports(
  p_status text default null,
  p_limit integer default 50
)
returns table (
  report_id uuid,
  status text,
  context text,
  reason text,
  created_at timestamptz,
  reporter_id uuid,
  reporter_name text,
  reporter_email text,
  reported_user_id uuid,
  reported_name text,
  reported_email text,
  message_id uuid,
  admin_note text,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  status_filter text := nullif(trim(coalesce(p_status, '')), '');
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  if status_filter is not null and status_filter not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Invalid report status';
  end if;

  return query
  select
    r.id,
    r.status,
    r.context,
    r.reason,
    r.created_at,
    r.reporter_id,
    coalesce(reporter.display_name, split_part(reporter_user.email, '@', 1)),
    reporter_user.email::text,
    r.reported_user_id,
    coalesce(reported.display_name, split_part(reported_user.email, '@', 1)),
    reported_user.email::text,
    r.message_id,
    coalesce(m.admin_note, ''),
    m.reviewed_at
  from public.user_reports r
  join auth.users reporter_user on reporter_user.id = r.reporter_id
  join auth.users reported_user on reported_user.id = r.reported_user_id
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported on reported.id = r.reported_user_id
  left join private.report_moderation m on m.report_id = r.id
  where status_filter is null or r.status = status_filter
  order by
    case r.status when 'open' then 0 when 'reviewing' then 1 else 2 end,
    r.created_at desc
  limit row_limit;
end;
$$;

create or replace function public.admin_update_report(
  p_report_id uuid,
  p_status text,
  p_note text default ''
)
returns table (
  report_id uuid,
  status text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean_note text := left(trim(coalesce(p_note, '')), 500);
  changed integer;
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  if p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Invalid report status';
  end if;

  update public.user_reports r
  set status = p_status
  where r.id = p_report_id;
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'Report not found';
  end if;

  insert into private.report_moderation (report_id, admin_note, reviewed_by, reviewed_at)
  values (p_report_id, clean_note, caller, now())
  on conflict (report_id) do update set
    admin_note = excluded.admin_note,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at;

  insert into private.admin_audit_log (actor_id, action, details)
  values (
    caller,
    'update_report_status',
    jsonb_build_object('report_id', p_report_id, 'status', p_status)
  );

  return query
  select r.id, r.status, m.reviewed_at
  from public.user_reports r
  join private.report_moderation m on m.report_id = r.id
  where r.id = p_report_id;
end;
$$;

create or replace function public.admin_list_rooms()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  icon text,
  active boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  return query
  select r.id, r.slug, r.name, r.description, r.icon, r.active, r.sort_order
  from public.rooms r
  order by r.sort_order, r.name;
end;
$$;

create or replace function public.admin_set_room_active(
  p_room_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  room_exists boolean;
begin
  if caller is null or not private.is_admin(caller) then
    raise exception 'Admin access required';
  end if;

  select exists (select 1 from public.rooms r where r.id = p_room_id)
  into room_exists;
  if not room_exists then
    raise exception 'Room not found';
  end if;

  if not p_active
     and (select count(*) from public.rooms r where r.active and r.id <> p_room_id) = 0 then
    raise exception 'At least one public room must stay open';
  end if;

  update public.rooms r set active = p_active where r.id = p_room_id;

  insert into private.admin_audit_log (actor_id, action, details)
  values (
    caller,
    'set_room_active',
    jsonb_build_object('room_id', p_room_id, 'active', p_active)
  );

  return p_active;
end;
$$;

revoke all on function public.get_admin_access() from public, anon, authenticated;
revoke all on function public.get_admin_dashboard() from public, anon, authenticated;
revoke all on function public.admin_list_members(text, integer) from public, anon, authenticated;
revoke all on function public.admin_set_entitlement(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_list_reports(text, integer) from public, anon, authenticated;
revoke all on function public.admin_update_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_list_rooms() from public, anon, authenticated;
revoke all on function public.admin_set_room_active(uuid, boolean) from public, anon, authenticated;

grant execute on function public.get_admin_access() to authenticated;
grant execute on function public.get_admin_dashboard() to authenticated;
grant execute on function public.admin_list_members(text, integer) to authenticated;
grant execute on function public.admin_set_entitlement(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.admin_list_reports(text, integer) to authenticated;
grant execute on function public.admin_update_report(uuid, text, text) to authenticated;
grant execute on function public.admin_list_rooms() to authenticated;
grant execute on function public.admin_set_room_active(uuid, boolean) to authenticated;
