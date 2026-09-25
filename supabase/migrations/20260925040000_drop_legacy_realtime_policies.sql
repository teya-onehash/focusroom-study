-- Remove obsolete prototype topics. Current native calls use the access-checked
-- dm-call:* and study-room:(public|private):* topic families instead.

drop policy if exists "Mellow native call signaling read v1" on realtime.messages;
drop policy if exists "Mellow native call signaling write v1" on realtime.messages;

notify pgrst, 'reload schema';
