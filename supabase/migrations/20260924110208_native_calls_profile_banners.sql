-- Native one-to-one WebRTC signaling and public profile banners.
-- Realtime messages are ephemeral. Only the two members in a live DM call
-- can send or receive signaling on that call's private Broadcast topic.

alter table public.profiles
  add column if not exists profile_banner text not null default 'midnight';

alter table public.profiles
  drop constraint if exists profiles_profile_banner_check;

alter table public.profiles
  add constraint profiles_profile_banner_check
  check (profile_banner in (
    'midnight', 'aurora', 'cherry', 'ocean',
    'sunset', 'matcha', 'notebook', 'arcade'
  ));

create or replace function private.can_signal_dm_call(check_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and check_topic like 'dm-call:%'
    and exists (
      select 1
      from public.dm_calls c
      where check_topic = 'dm-call:' || c.id::text
        and c.status in ('ringing', 'active')
        and c.expires_at > now()
        and ((select auth.uid()) = c.caller_id or (select auth.uid()) = c.callee_id)
        and private.can_access_dm(c.conversation_id)
    );
$$;

revoke all on function private.can_signal_dm_call(text) from public, anon, authenticated;
grant execute on function private.can_signal_dm_call(text) to authenticated;

drop policy if exists "DM call participants receive signaling" on realtime.messages;
create policy "DM call participants receive signaling"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and private.can_signal_dm_call((select realtime.topic()))
);

drop policy if exists "DM call participants send signaling" on realtime.messages;
create policy "DM call participants send signaling"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and private.can_signal_dm_call((select realtime.topic()))
);

drop function if exists public.get_member_profile(uuid);
create function public.get_member_profile(p_member_id uuid)
returns table (
  id uuid,
  display_name text,
  bio text,
  subject text,
  country text,
  avatar_color text,
  avatar_path text,
  profile_frame text,
  profile_sticker text,
  profile_banner text,
  accepting_dms boolean,
  pinned_by_count bigint,
  pins_count bigint,
  viewer_has_pinned boolean,
  is_self boolean,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = caller and b.blocked_id = p_member_id)
       or (b.blocker_id = p_member_id and b.blocked_id = caller)
  ) then raise exception 'This profile is unavailable'; end if;

  return query
  select p.id, p.display_name, p.bio, p.subject,
    case when p.id = caller or p.show_country then p.country else '' end,
    p.avatar_color, p.avatar_path, p.profile_frame, p.profile_sticker,
    p.profile_banner, p.accepting_dms,
    (select count(*) from public.profile_pins x where x.pinned_id = p.id),
    (select count(*) from public.profile_pins x where x.pinner_id = p.id),
    exists (
      select 1 from public.profile_pins x
      where x.pinner_id = caller and x.pinned_id = p.id
    ),
    p.id = caller,
    p.created_at
  from public.profiles p
  where p.id = p_member_id and (p.id = caller or p.show_profile);
end;
$$;

revoke all on function public.get_member_profile(uuid) from public, anon, authenticated;
grant execute on function public.get_member_profile(uuid) to authenticated;

drop function if exists public.list_member_profiles(integer);
create function public.list_member_profiles(p_limit integer default 24)
returns table (
  id uuid,
  display_name text,
  subject text,
  avatar_color text,
  avatar_path text,
  profile_frame text,
  profile_sticker text,
  profile_banner text,
  pinned_by_count bigint,
  viewer_has_pinned boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  return query
  select p.id, p.display_name, p.subject, p.avatar_color, p.avatar_path,
    p.profile_frame, p.profile_sticker, p.profile_banner,
    (select count(*) from public.profile_pins x where x.pinned_id = p.id),
    exists (
      select 1 from public.profile_pins x
      where x.pinner_id = caller and x.pinned_id = p.id
    )
  from public.profiles p
  where p.show_profile and p.id <> caller
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = caller and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = caller)
    )
  order by (
    select count(*) from public.profile_pins x where x.pinned_id = p.id
  ) desc, p.updated_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
end;
$$;

revoke all on function public.list_member_profiles(integer) from public, anon, authenticated;
grant execute on function public.list_member_profiles(integer) to authenticated;

notify pgrst, 'reload schema';
