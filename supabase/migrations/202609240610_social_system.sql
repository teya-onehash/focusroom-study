-- FocusRoom social profiles, pins, profile photos, safety, and direct messages.
-- Raw social-graph and moderation data stays behind authenticated RPCs so
-- counts and access rules cannot be forged by the browser.

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists accepting_dms boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_avatar_path_owner_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_owner_check
      check (
        avatar_path is null
        or (
          char_length(avatar_path) <= 300
          and split_part(avatar_path, '/', 1) = id::text
          and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
        )
      );
  end if;
end
$$;

alter table public.subscriptions drop constraint if exists subscriptions_tier_check;
alter table public.subscriptions alter column tier set default 'premium';
alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('basic', 'premium', 'buddy', 'plus'));

create table public.profile_pins (
  pinner_id uuid not null references auth.users(id) on delete cascade,
  pinned_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pinner_id, pinned_id),
  check (pinner_id <> pinned_id)
);

create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  accepted boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a <> user_b),
  check (user_a < user_b),
  check (created_by = user_a or created_by = user_b)
);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'voice')),
  body text not null default '' check (char_length(body) <= 2000),
  storage_path text check (storage_path is null or char_length(storage_path) <= 500),
  mime_type text check (mime_type is null or char_length(mime_type) <= 100),
  byte_size integer check (byte_size is null or byte_size between 1 and 6291456),
  created_at timestamptz not null default now(),
  check (
    (kind = 'text' and char_length(trim(body)) between 1 and 2000 and storage_path is null)
    or
    (kind in ('image', 'voice') and storage_path is not null)
  )
);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.dm_messages(id) on delete set null,
  context text not null default 'profile' check (context in ('profile', 'message', 'avatar')),
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

create index profile_pins_pinned_created_idx on public.profile_pins (pinned_id, created_at desc);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);
create index dm_conversations_user_a_last_idx on public.dm_conversations (user_a, last_message_at desc);
create index dm_conversations_user_b_last_idx on public.dm_conversations (user_b, last_message_at desc);
create index dm_messages_conversation_created_idx on public.dm_messages (conversation_id, created_at);
create index dm_messages_sender_created_idx on public.dm_messages (sender_id, created_at desc);
create index user_reports_reporter_created_idx on public.user_reports (reporter_id, created_at desc);
create index user_reports_reported_created_idx on public.user_reports (reported_user_id, created_at desc);

alter table public.profile_pins enable row level security;
alter table public.user_blocks enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;
alter table public.user_reports enable row level security;

create or replace function private.current_plan(check_user_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case when s.tier = 'plus' then 'premium' else s.tier end
    from public.subscriptions s
    where s.user_id = check_user_id
      and s.status in ('trialing', 'active')
      and (s.current_period_end is null or s.current_period_end > now())
    limit 1
  ), 'free');
$$;

create or replace function private.is_plus(check_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_plan(check_user_id) in ('premium', 'buddy');
$$;

create or replace function private.pin_limit(check_user_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case private.current_plan(check_user_id)
    when 'basic' then 20
    when 'premium' then 40
    when 'buddy' then 40
    else 4
  end;
$$;

create or replace function private.can_access_dm(check_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.dm_conversations c
    where c.id = check_conversation_id
      and ((select auth.uid()) = c.user_a or (select auth.uid()) = c.user_b)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = c.user_a and b.blocked_id = c.user_b)
           or (b.blocker_id = c.user_b and b.blocked_id = c.user_a)
      )
  );
$$;

revoke all on function private.current_plan(uuid) from public, anon, authenticated;
revoke all on function private.is_plus(uuid) from public, anon, authenticated;
revoke all on function private.pin_limit(uuid) from public, anon, authenticated;
revoke all on function private.can_access_dm(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_access_dm(uuid) to authenticated;

create policy "Participants read conversations"
on public.dm_conversations for select to authenticated
using (private.can_access_dm(id));

create policy "Participants read messages"
on public.dm_messages for select to authenticated
using (private.can_access_dm(conversation_id));

create policy "Users read own reports"
on public.user_reports for select to authenticated
using ((select auth.uid()) = reporter_id);

create or replace function public.get_member_profile(p_member_id uuid)
returns table (
  id uuid,
  display_name text,
  bio text,
  subject text,
  country text,
  avatar_color text,
  avatar_path text,
  accepting_dms boolean,
  pinned_by_count bigint,
  pins_count bigint,
  viewer_has_pinned boolean,
  is_self boolean,
  joined_at timestamptz
)
language plpgsql stable security definer set search_path = ''
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
    p.avatar_color, p.avatar_path, p.accepting_dms,
    (select count(*) from public.profile_pins x where x.pinned_id = p.id),
    (select count(*) from public.profile_pins x where x.pinner_id = p.id),
    exists (select 1 from public.profile_pins x where x.pinner_id = caller and x.pinned_id = p.id),
    p.id = caller,
    p.created_at
  from public.profiles p
  where p.id = p_member_id and (p.id = caller or p.show_profile);
end;
$$;

create or replace function public.list_member_profiles(p_limit integer default 24)
returns table (
  id uuid,
  display_name text,
  subject text,
  avatar_color text,
  avatar_path text,
  pinned_by_count bigint,
  viewer_has_pinned boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  return query
  select p.id, p.display_name, p.subject, p.avatar_color, p.avatar_path,
    (select count(*) from public.profile_pins x where x.pinned_id = p.id),
    exists (select 1 from public.profile_pins x where x.pinner_id = caller and x.pinned_id = p.id)
  from public.profiles p
  where p.show_profile and p.id <> caller
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = caller and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = caller)
    )
  order by (select count(*) from public.profile_pins x where x.pinned_id = p.id) desc,
    p.updated_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
end;
$$;

create or replace function public.pin_member(p_member_id uuid)
returns table (is_pinned boolean, pinned_by_count bigint, pins_count bigint, pin_limit integer)
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  allowed integer;
  used integer;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if caller = p_member_id then raise exception 'You cannot pin yourself'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_member_id and p.show_profile) then
    raise exception 'This profile is unavailable';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = caller and b.blocked_id = p_member_id)
       or (b.blocker_id = p_member_id and b.blocked_id = caller)
  ) then raise exception 'This profile is unavailable'; end if;

  perform pg_advisory_xact_lock(hashtext(caller::text || ':pins'));
  if not exists (
    select 1 from public.profile_pins x
    where x.pinner_id = caller and x.pinned_id = p_member_id
  ) then
    allowed := private.pin_limit(caller);
    select count(*) into used from public.profile_pins x where x.pinner_id = caller;
    if used >= allowed then raise exception 'Your plan can pin up to % people', allowed; end if;
    insert into public.profile_pins (pinner_id, pinned_id) values (caller, p_member_id);
  end if;

  return query select true,
    (select count(*) from public.profile_pins x where x.pinned_id = p_member_id),
    (select count(*) from public.profile_pins x where x.pinner_id = p_member_id),
    private.pin_limit(caller);
end;
$$;

create or replace function public.unpin_member(p_member_id uuid)
returns table (is_pinned boolean, pinned_by_count bigint, pins_count bigint, pin_limit integer)
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  delete from public.profile_pins x where x.pinner_id = caller and x.pinned_id = p_member_id;
  return query select false,
    (select count(*) from public.profile_pins x where x.pinned_id = p_member_id),
    (select count(*) from public.profile_pins x where x.pinner_id = p_member_id),
    private.pin_limit(caller);
end;
$$;

create or replace function public.start_dm(p_recipient_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation_id uuid;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if caller = p_recipient_id then raise exception 'You cannot message yourself'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_recipient_id and p.show_profile and p.accepting_dms
  ) then raise exception 'This member is not accepting messages'; end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = caller and b.blocked_id = p_recipient_id)
       or (b.blocker_id = p_recipient_id and b.blocked_id = caller)
  ) then raise exception 'Messaging is unavailable'; end if;

  first_user := least(caller, p_recipient_id);
  second_user := greatest(caller, p_recipient_id);
  insert into public.dm_conversations (user_a, user_b, created_by)
  values (first_user, second_user, caller)
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into conversation_id;
  return conversation_id;
end;
$$;

create or replace function public.accept_dm(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  update public.dm_conversations c
  set accepted = true
  where c.id = p_conversation_id
    and (c.user_a = caller or c.user_b = caller)
    and c.created_by <> caller
    and private.can_access_dm(c.id);
  if not found then raise exception 'Message request cannot be accepted'; end if;
  return true;
end;
$$;

create or replace function public.send_dm(
  p_conversation_id uuid,
  p_kind text default 'text',
  p_body text default '',
  p_storage_path text default null,
  p_mime_type text default null,
  p_byte_size integer default null
)
returns public.dm_messages
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  convo public.dm_conversations;
  sent public.dm_messages;
  caller_plan text;
  daily_limit integer;
  daily_used integer;
  burst_used integer;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  select * into convo from public.dm_conversations c
  where c.id = p_conversation_id and (c.user_a = caller or c.user_b = caller);
  if convo.id is null or not private.can_access_dm(p_conversation_id) then
    raise exception 'Conversation is unavailable';
  end if;
  if not convo.accepted then
    if convo.created_by <> caller or exists (
      select 1 from public.dm_messages m where m.conversation_id = convo.id
    ) then raise exception 'This message request must be accepted first'; end if;
  end if;
  if p_kind not in ('text', 'image', 'voice') then raise exception 'Invalid message type'; end if;
  if p_kind = 'text' and char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Message must be 1 to 2000 characters';
  end if;
  if p_kind in ('image', 'voice') then
    if p_storage_path is null or p_byte_size is null or p_byte_size not between 1 and 6291456 then
      raise exception 'Invalid attachment';
    end if;
    if split_part(p_storage_path, '/', 1) <> p_conversation_id::text
       or split_part(p_storage_path, '/', 2) <> caller::text then
      raise exception 'Invalid attachment path';
    end if;
    if p_kind = 'image' and coalesce(p_mime_type, '') not in ('image/jpeg','image/png','image/webp') then
      raise exception 'Unsupported image type';
    end if;
    if p_kind = 'voice' and coalesce(p_mime_type, '') not in ('audio/webm','audio/mp4','audio/mpeg','audio/ogg') then
      raise exception 'Unsupported audio type';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(caller::text || ':dm:' || current_date::text));
  select count(*) into burst_used from public.dm_messages m
  where m.sender_id = caller and m.created_at >= now() - interval '1 minute';
  if burst_used >= 120 then raise exception 'Please slow down and try again in a minute'; end if;

  caller_plan := private.current_plan(caller);
  daily_limit := case caller_plan when 'free' then 500 when 'basic' then 1000 else null end;
  if daily_limit is not null then
    select count(*) into daily_used from public.dm_messages m
    where m.sender_id = caller
      and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    if daily_used >= daily_limit then raise exception 'Daily message limit reached'; end if;
  end if;

  insert into public.dm_messages (conversation_id, sender_id, kind, body, storage_path, mime_type, byte_size)
  values (p_conversation_id, caller, p_kind, coalesce(p_body, ''), p_storage_path, p_mime_type, p_byte_size)
  returning * into sent;
  update public.dm_conversations set last_message_at = sent.created_at where id = p_conversation_id;
  return sent;
end;
$$;

create or replace function public.list_dm_conversations()
returns table (
  id uuid,
  other_user_id uuid,
  other_display_name text,
  other_avatar_color text,
  other_avatar_path text,
  accepted boolean,
  created_by uuid,
  last_message_at timestamptz,
  last_message text,
  last_kind text
)
language plpgsql stable security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  return query
  select c.id,
    case when c.user_a = caller then c.user_b else c.user_a end,
    p.display_name, p.avatar_color, p.avatar_path,
    c.accepted, c.created_by, c.last_message_at,
    coalesce(left(latest.body, 120), ''), coalesce(latest.kind, '')
  from public.dm_conversations c
  join public.profiles p on p.id = case when c.user_a = caller then c.user_b else c.user_a end
  left join lateral (
    select m.body, m.kind from public.dm_messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) latest on true
  where (c.user_a = caller or c.user_b = caller)
    and private.can_access_dm(c.id)
  order by c.last_message_at desc;
end;
$$;

create or replace function public.block_member(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if caller = p_user_id then raise exception 'You cannot block yourself'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (caller, p_user_id)
  on conflict do nothing;
  delete from public.profile_pins x
  where (x.pinner_id = caller and x.pinned_id = p_user_id)
     or (x.pinner_id = p_user_id and x.pinned_id = caller);
  return true;
end;
$$;

create or replace function public.report_member(
  p_user_id uuid,
  p_reason text,
  p_context text default 'profile',
  p_message_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  report_id uuid;
  recent_count integer;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if caller = p_user_id then raise exception 'You cannot report yourself'; end if;
  if p_context not in ('profile', 'message', 'avatar') then raise exception 'Invalid report context'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Please add a short reason';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.dm_messages m
    where m.id = p_message_id and m.sender_id = p_user_id and private.can_access_dm(m.conversation_id)
  ) then raise exception 'Message cannot be reported'; end if;
  select count(*) into recent_count from public.user_reports r
  where r.reporter_id = caller and r.created_at >= now() - interval '1 day';
  if recent_count >= 20 then raise exception 'Daily report limit reached'; end if;
  insert into public.user_reports (reporter_id, reported_user_id, message_id, context, reason)
  values (caller, p_user_id, p_message_id, p_context, trim(p_reason))
  returning id into report_id;
  return report_id;
end;
$$;

-- Keep the old RPC name for frontend compatibility while matching the new plans.
create or replace function public.get_weekly_allowance()
returns table (plan text, encouragements_remaining integer, boosts_remaining integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_plan text;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  encouragement_used integer;
  boosts_used integer;
  encouragement_limit integer;
  boost_limit integer;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  caller_plan := private.current_plan(caller);
  encouragement_limit := case caller_plan when 'basic' then 60 when 'premium' then 300 when 'buddy' then 300 else 30 end;
  boost_limit := case when caller_plan in ('premium', 'buddy') then 50 else 0 end;
  select count(*) into encouragement_used from public.encouragements e
  where e.sender_id = caller and e.kind = 'encouragement' and e.created_at >= day_start;
  select count(*) into boosts_used from public.encouragements e
  where e.sender_id = caller and e.kind = 'focus_boost' and e.created_at >= week_start;
  return query select caller_plan,
    greatest(encouragement_limit - encouragement_used, 0),
    greatest(boost_limit - boosts_used, 0);
end;
$$;

create or replace function public.send_encouragement(
  p_receiver_id uuid,
  p_kind text default 'encouragement',
  p_message text default ''
)
returns public.encouragements
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_plan text;
  used_count integer;
  limit_count integer;
  period_start timestamptz;
  sent public.encouragements;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if caller = p_receiver_id then raise exception 'You cannot encourage yourself'; end if;
  if p_kind not in ('encouragement', 'focus_boost') then raise exception 'Invalid encouragement type'; end if;
  if char_length(coalesce(p_message, '')) > 160 then raise exception 'Message is too long'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_receiver_id and p.accepting_encouragements and p.show_profile
  ) then raise exception 'This member is not accepting encouragements'; end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = caller and b.blocked_id = p_receiver_id)
       or (b.blocker_id = p_receiver_id and b.blocked_id = caller)
  ) then raise exception 'This profile is unavailable'; end if;

  caller_plan := private.current_plan(caller);
  if p_kind = 'focus_boost' and caller_plan not in ('premium', 'buddy') then
    raise exception 'Focus Boosts require Premium or Buddy';
  end if;
  if p_kind = 'focus_boost' then
    limit_count := 50;
    period_start := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  else
    limit_count := case caller_plan when 'basic' then 60 when 'premium' then 300 when 'buddy' then 300 else 30 end;
    period_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  end if;

  perform pg_advisory_xact_lock(hashtext(caller::text || p_kind || period_start::text));
  select count(*) into used_count from public.encouragements e
  where e.sender_id = caller and e.kind = p_kind and e.created_at >= period_start;
  if used_count >= limit_count then raise exception 'Allowance reached'; end if;
  insert into public.encouragements (sender_id, receiver_id, kind, message)
  values (caller, p_receiver_id, p_kind, coalesce(trim(p_message), ''))
  returning * into sent;
  return sent;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars', 'profile-avatars', true, 4194304,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-media', 'dm-media', false, 6291456,
  array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/ogg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload own profile avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users delete own profile avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Participants read DM media"
on storage.objects for select to authenticated
using (
  bucket_id = 'dm-media'
  and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
  and private.can_access_dm(split_part(name, '/', 1)::uuid)
);

create policy "Participants upload own DM media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dm-media'
  and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and private.can_access_dm(split_part(name, '/', 1)::uuid)
);

create policy "Owners delete own DM media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'dm-media'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages'
     ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end
$$;

revoke all on public.profile_pins, public.user_blocks, public.dm_conversations,
  public.dm_messages, public.user_reports from anon, authenticated;
grant select on public.dm_conversations, public.dm_messages to authenticated;
grant select on public.user_reports to authenticated;

revoke all on function public.get_member_profile(uuid) from public, anon, authenticated;
revoke all on function public.list_member_profiles(integer) from public, anon, authenticated;
revoke all on function public.pin_member(uuid) from public, anon, authenticated;
revoke all on function public.unpin_member(uuid) from public, anon, authenticated;
revoke all on function public.start_dm(uuid) from public, anon, authenticated;
revoke all on function public.accept_dm(uuid) from public, anon, authenticated;
revoke all on function public.send_dm(uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.list_dm_conversations() from public, anon, authenticated;
revoke all on function public.block_member(uuid) from public, anon, authenticated;
revoke all on function public.report_member(uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function public.get_member_profile(uuid) to authenticated;
grant execute on function public.list_member_profiles(integer) to authenticated;
grant execute on function public.pin_member(uuid) to authenticated;
grant execute on function public.unpin_member(uuid) to authenticated;
grant execute on function public.start_dm(uuid) to authenticated;
grant execute on function public.accept_dm(uuid) to authenticated;
grant execute on function public.send_dm(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.list_dm_conversations() to authenticated;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.report_member(uuid, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
