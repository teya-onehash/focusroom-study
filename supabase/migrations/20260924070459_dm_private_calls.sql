-- Premium direct-message audio/video calls.
-- The media itself is handled by Jitsi; this table stores only call state and
-- an opaque room relationship. Access is limited to the two DM participants.

create table if not exists public.dm_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  room_id uuid not null unique references public.private_rooms(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  call_mode text not null,
  status text not null default 'ringing',
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  constraint dm_calls_participants_different check (caller_id <> callee_id),
  constraint dm_calls_mode_valid check (call_mode in ('audio', 'video')),
  constraint dm_calls_status_valid check (status in ('ringing', 'active', 'declined', 'cancelled', 'missed', 'ended')),
  constraint dm_calls_expiry_after_creation check (expires_at > created_at)
);

create index if not exists dm_calls_conversation_created_idx
  on public.dm_calls (conversation_id, created_at desc);
create index if not exists dm_calls_caller_created_idx
  on public.dm_calls (caller_id, created_at desc);
create index if not exists dm_calls_callee_status_expiry_idx
  on public.dm_calls (callee_id, status, expires_at);
create unique index if not exists dm_calls_one_live_per_conversation_idx
  on public.dm_calls (conversation_id)
  where status in ('ringing', 'active');

alter table public.dm_calls enable row level security;

drop policy if exists "Participants read DM calls" on public.dm_calls;
create policy "Participants read DM calls"
on public.dm_calls
for select
to authenticated
using ((select private.can_access_dm(conversation_id)));

revoke all on table public.dm_calls from public, anon;
grant select on table public.dm_calls to authenticated;

create or replace function private.dm_call_payload(check_call_id uuid)
returns table (
  id uuid,
  conversation_id uuid,
  room_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  jitsi_room text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
    c.conversation_id,
    c.room_id,
    c.caller_id,
    c.callee_id,
    c.call_mode,
    c.status,
    c.created_at,
    c.answered_at,
    c.ended_at,
    c.expires_at,
    case
      when c.status in ('ringing', 'active')
       and (
         c.caller_id = (select auth.uid())
         or exists (
           select 1
           from public.private_room_members m
           where m.room_id = c.room_id
             and m.user_id = (select auth.uid())
         )
       )
      then r.jitsi_room
      else null
    end
  from public.dm_calls c
  join public.private_rooms r on r.id = c.room_id
  where c.id = check_call_id
    and (select private.can_access_dm(c.conversation_id));
$$;

revoke all on function private.dm_call_payload(uuid) from public, anon, authenticated;

create or replace function public.start_dm_call(p_conversation_id uuid, p_call_mode text)
returns table (
  id uuid,
  conversation_id uuid,
  room_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  jitsi_room text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  convo public.dm_conversations;
  recipient uuid;
  created_room public.private_rooms;
  created_call public.dm_calls;
  recent_calls integer;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if p_call_mode not in ('audio', 'video') then raise exception 'Choose an audio or video call'; end if;
  if not private.is_plus(caller) then raise exception 'Private calls require Premium or Buddy'; end if;

  select * into convo
  from public.dm_conversations c
  where c.id = p_conversation_id
    and (c.user_a = caller or c.user_b = caller)
  for update;

  if convo.id is null or not private.can_access_dm(p_conversation_id) then
    raise exception 'Conversation unavailable';
  end if;
  if not convo.accepted then raise exception 'Accept the message request before calling'; end if;

  recipient := case when convo.user_a = caller then convo.user_b else convo.user_a end;
  if not exists (
    select 1 from public.profiles p where p.id = recipient and p.allow_invites
  ) then
    raise exception 'This member has paused private call invites';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text || ':dm-call', 0));

  update public.private_rooms r
  set active = false
  where exists (
    select 1 from public.dm_calls c
    where c.room_id = r.id
      and c.conversation_id = p_conversation_id
      and c.status in ('ringing', 'active')
      and c.expires_at <= now()
  );

  update public.dm_calls c
  set status = case when c.status = 'ringing' then 'missed' else 'ended' end,
      ended_at = coalesce(c.ended_at, now())
  where c.conversation_id = p_conversation_id
    and c.status in ('ringing', 'active')
    and c.expires_at <= now();

  if exists (
    select 1 from public.dm_calls c
    where c.conversation_id = p_conversation_id
      and c.status in ('ringing', 'active')
  ) then
    raise exception 'There is already a live call in this conversation';
  end if;

  select count(*) into recent_calls
  from public.dm_calls c
  where c.caller_id = caller
    and c.created_at >= now() - interval '1 hour';
  if recent_calls >= 15 then raise exception 'Call limit reached. Try again later'; end if;

  insert into public.private_rooms (
    host_id, title, call_mode, jitsi_room, max_participants, expires_at
  ) values (
    caller,
    'Direct message call',
    p_call_mode,
    'FocusRoomDM-' || replace(gen_random_uuid()::text, '-', ''),
    2,
    now() + interval '3 minutes'
  ) returning * into created_room;

  insert into public.private_room_members (room_id, user_id)
  values (created_room.id, caller);

  insert into public.dm_calls (
    conversation_id, room_id, caller_id, callee_id, call_mode, expires_at
  ) values (
    p_conversation_id, created_room.id, caller, recipient, p_call_mode,
    now() + interval '3 minutes'
  ) returning * into created_call;

  return query select * from private.dm_call_payload(created_call.id);
end;
$$;

create or replace function public.answer_dm_call(p_call_id uuid, p_response text)
returns table (
  id uuid,
  conversation_id uuid,
  room_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  jitsi_room text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  call_row public.dm_calls;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if p_response not in ('accept', 'decline') then raise exception 'Invalid call response'; end if;

  select * into call_row
  from public.dm_calls c
  where c.id = p_call_id
  for update;

  if call_row.id is null or call_row.callee_id <> caller then
    raise exception 'Call unavailable';
  end if;
  if not private.can_access_dm(call_row.conversation_id) then raise exception 'Call unavailable'; end if;
  if call_row.status <> 'ringing' then raise exception 'This call is no longer ringing'; end if;
  if call_row.expires_at <= now() then raise exception 'This call has expired'; end if;

  if p_response = 'decline' then
    update public.dm_calls c
    set status = 'declined', ended_at = now()
    where c.id = p_call_id;
    update public.private_rooms r set active = false where r.id = call_row.room_id;
  else
    insert into public.private_room_members (room_id, user_id)
    values (call_row.room_id, caller)
    on conflict do nothing;
    update public.private_rooms r
    set active = true, expires_at = now() + interval '2 hours'
    where r.id = call_row.room_id;
    update public.dm_calls c
    set status = 'active', answered_at = now(), expires_at = now() + interval '2 hours'
    where c.id = p_call_id;
  end if;

  return query select * from private.dm_call_payload(p_call_id);
end;
$$;

create or replace function public.end_dm_call(p_call_id uuid)
returns table (
  id uuid,
  conversation_id uuid,
  room_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  jitsi_room text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  call_row public.dm_calls;
begin
  if caller is null then raise exception 'Authentication required'; end if;

  select * into call_row
  from public.dm_calls c
  where c.id = p_call_id
    and (c.caller_id = caller or c.callee_id = caller)
  for update;

  if call_row.id is null or not private.can_access_dm(call_row.conversation_id) then
    raise exception 'Call unavailable';
  end if;

  if call_row.status in ('ringing', 'active') then
    update public.dm_calls c
    set status = case
      when call_row.status = 'ringing' and call_row.callee_id = caller then 'declined'
      when call_row.status = 'ringing' then 'cancelled'
      else 'ended'
    end,
    ended_at = now()
    where c.id = p_call_id;
    update public.private_rooms r set active = false where r.id = call_row.room_id;
  end if;

  return query select * from private.dm_call_payload(p_call_id);
end;
$$;

create or replace function public.list_dm_calls(p_conversation_id uuid, p_limit integer default 30)
returns table (
  id uuid,
  conversation_id uuid,
  room_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  jitsi_room text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if not private.can_access_dm(p_conversation_id) then raise exception 'Conversation unavailable'; end if;

  update public.private_rooms r
  set active = false
  where exists (
    select 1 from public.dm_calls c
    where c.room_id = r.id
      and c.conversation_id = p_conversation_id
      and c.status in ('ringing', 'active')
      and c.expires_at <= now()
  );
  update public.dm_calls c
  set status = case when c.status = 'ringing' then 'missed' else 'ended' end,
      ended_at = coalesce(c.ended_at, now())
  where c.conversation_id = p_conversation_id
    and c.status in ('ringing', 'active')
    and c.expires_at <= now();

  return query
  select payload.*
  from (
    select c.id
    from public.dm_calls c
    where c.conversation_id = p_conversation_id
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 50))
  ) recent
  cross join lateral private.dm_call_payload(recent.id) payload
  order by payload.created_at;
end;
$$;

create or replace function public.list_pending_dm_calls()
returns table (
  id uuid,
  conversation_id uuid,
  caller_id uuid,
  call_mode text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  caller_display_name text,
  caller_avatar_color text,
  caller_avatar_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required'; end if;

  update public.private_rooms r
  set active = false
  where exists (
    select 1 from public.dm_calls c
    where c.room_id = r.id
      and c.callee_id = caller
      and c.status = 'ringing'
      and c.expires_at <= now()
  );
  update public.dm_calls c
  set status = 'missed', ended_at = coalesce(c.ended_at, now())
  where c.callee_id = caller
    and c.status = 'ringing'
    and c.expires_at <= now();

  return query
  select c.id, c.conversation_id, c.caller_id, c.call_mode, c.status,
    c.created_at, c.expires_at, p.display_name, p.avatar_color, p.avatar_path
  from public.dm_calls c
  join public.profiles p on p.id = c.caller_id
  where c.callee_id = caller
    and c.status = 'ringing'
    and c.expires_at > now()
    and private.can_access_dm(c.conversation_id)
  order by c.created_at desc
  limit 10;
end;
$$;

revoke all on function public.start_dm_call(uuid, text) from public, anon;
revoke all on function public.answer_dm_call(uuid, text) from public, anon;
revoke all on function public.end_dm_call(uuid) from public, anon;
revoke all on function public.list_dm_calls(uuid, integer) from public, anon;
revoke all on function public.list_pending_dm_calls() from public, anon;

grant execute on function public.start_dm_call(uuid, text) to authenticated;
grant execute on function public.answer_dm_call(uuid, text) to authenticated;
grant execute on function public.end_dm_call(uuid) to authenticated;
grant execute on function public.list_dm_calls(uuid, integer) to authenticated;
grant execute on function public.list_pending_dm_calls() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dm_calls'
  ) then
    alter publication supabase_realtime add table public.dm_calls;
  end if;
end $$;
