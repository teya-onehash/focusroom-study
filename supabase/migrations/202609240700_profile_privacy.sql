-- Public profiles are read only through curated RPCs. This prevents a signed-in
-- client from selecting hidden fields (for example a country when show_country
-- is disabled) directly from the profiles table.

drop policy if exists "Profiles visible according to privacy" on public.profiles;

create policy "Users read own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create or replace function public.list_received_encouragements(p_limit integer default 30)
returns table (
  id uuid,
  sender_id uuid,
  sender_display_name text,
  sender_avatar_color text,
  sender_avatar_path text,
  kind text,
  message text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  return query
  select e.id, e.sender_id, p.display_name, p.avatar_color, p.avatar_path,
    e.kind, e.message, e.created_at
  from public.encouragements e
  join public.profiles p on p.id = e.sender_id
  where e.receiver_id = caller
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = caller and b.blocked_id = e.sender_id)
         or (b.blocker_id = e.sender_id and b.blocked_id = caller)
    )
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke all on function public.list_received_encouragements(integer) from public, anon, authenticated;
grant execute on function public.list_received_encouragements(integer) to authenticated;

notify pgrst, 'reload schema';
