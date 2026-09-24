-- Explicit deny policies and foreign-key indexes for the private admin schema.

create policy "No direct client access to app admins"
on private.app_admins
for all
to anon, authenticated
using (false)
with check (false);

create policy "No direct client access to entitlements"
on private.complimentary_entitlements
for all
to anon, authenticated
using (false)
with check (false);

create policy "No direct client access to report moderation"
on private.report_moderation
for all
to anon, authenticated
using (false)
with check (false);

create policy "No direct client access to admin audit log"
on private.admin_audit_log
for all
to anon, authenticated
using (false)
with check (false);

create index if not exists app_admins_created_by_idx
  on private.app_admins (created_by)
  where created_by is not null;

create index if not exists complimentary_entitlements_granted_by_idx
  on private.complimentary_entitlements (granted_by);

create index if not exists report_moderation_reviewed_by_idx
  on private.report_moderation (reviewed_by);

create index if not exists admin_audit_log_actor_created_idx
  on private.admin_audit_log (actor_id, created_at desc);

create index if not exists admin_audit_log_target_user_idx
  on private.admin_audit_log (target_user_id)
  where target_user_id is not null;
