-- Advisor follow-up: retain RPC-only table privileges while documenting the
-- ownership boundary in RLS, and index every foreign key used by cascades.

create policy "Users view their own pin relationships"
on public.profile_pins for select to authenticated
using ((select auth.uid()) in (pinner_id, pinned_id));

create policy "Users view their own blocks"
on public.user_blocks for select to authenticated
using ((select auth.uid()) = blocker_id);

create index dm_conversations_created_by_idx
  on public.dm_conversations (created_by);

create index user_reports_message_id_idx
  on public.user_reports (message_id)
  where message_id is not null;
