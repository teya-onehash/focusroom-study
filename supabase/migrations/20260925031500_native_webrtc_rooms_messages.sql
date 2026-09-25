-- Secure native WebRTC signaling for public study rooms, private study rooms,
-- and direct-message calls. Media is never stored in Supabase; Realtime carries
-- only ephemeral SDP, ICE, presence, chat, and live encouragement events.

create or replace function private.can_signal_study_room(check_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  room_scope text;
  room_id uuid;
begin
  if caller is null or check_topic !~ '^study-room:(public|private):[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  room_scope := split_part(check_topic, ':', 2);
  begin
    room_id := split_part(check_topic, ':', 3)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if room_scope = 'public' then
    return exists (
      select 1
      from public.rooms r
      join public.focus_room_visits v
        on v.room_id = r.id
       and v.user_id = caller
       and v.ended_at is null
       and v.last_seen_at > now() - interval '2 minutes'
      where r.id = room_id and r.active
    );
  end if;

  return exists (
    select 1
    from public.private_rooms r
    join public.private_room_members m on m.room_id = r.id
    where r.id = room_id
      and m.user_id = caller
      and r.active
      and r.expires_at > now()
  );
end;
$$;

revoke all on function private.can_signal_study_room(text) from public, anon, authenticated;
grant execute on function private.can_signal_study_room(text) to authenticated;

drop policy if exists "Study room members receive signaling" on realtime.messages;
create policy "Study room members receive signaling"
on realtime.messages
for select
to authenticated
using (
  extension in ('broadcast', 'presence')
  and private.can_signal_study_room((select realtime.topic()))
);

drop policy if exists "Study room members send signaling" on realtime.messages;
create policy "Study room members send signaling"
on realtime.messages
for insert
to authenticated
with check (
  extension in ('broadcast', 'presence')
  and private.can_signal_study_room((select realtime.topic()))
);

-- DM calls use Presence for peer discovery as well as Broadcast for signaling.
drop policy if exists "DM call participants receive signaling" on realtime.messages;
create policy "DM call participants receive signaling"
on realtime.messages
for select
to authenticated
using (
  extension in ('broadcast', 'presence')
  and private.can_signal_dm_call((select realtime.topic()))
);

drop policy if exists "DM call participants send signaling" on realtime.messages;
create policy "DM call participants send signaling"
on realtime.messages
for insert
to authenticated
with check (
  extension in ('broadcast', 'presence')
  and private.can_signal_dm_call((select realtime.topic()))
);

-- Lightweight, private message reactions add useful actions without exposing
-- who reacted outside the two-person conversation.
create table if not exists public.dm_message_reactions (
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint dm_message_reactions_emoji_check
    check (emoji in ('♡', '👍', '✦', '😂', '👏'))
);

create index if not exists dm_message_reactions_message_idx
  on public.dm_message_reactions (message_id, created_at);

alter table public.dm_message_reactions enable row level security;

drop policy if exists "Participants read DM reactions" on public.dm_message_reactions;
create policy "Participants read DM reactions"
on public.dm_message_reactions
for select
to authenticated
using (
  exists (
    select 1 from public.dm_messages m
    where m.id = message_id and private.can_access_dm(m.conversation_id)
  )
);

drop policy if exists "Participants add own DM reactions" on public.dm_message_reactions;
create policy "Participants add own DM reactions"
on public.dm_message_reactions
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.dm_messages m
    where m.id = message_id and private.can_access_dm(m.conversation_id)
  )
);

drop policy if exists "Participants remove own DM reactions" on public.dm_message_reactions;
create policy "Participants remove own DM reactions"
on public.dm_message_reactions
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.dm_messages m
    where m.id = message_id and private.can_access_dm(m.conversation_id)
  )
);

revoke all on table public.dm_message_reactions from public, anon;
grant select, insert, delete on table public.dm_message_reactions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dm_message_reactions'
  ) then
    alter publication supabase_realtime add table public.dm_message_reactions;
  end if;
end $$;

notify pgrst, 'reload schema';
