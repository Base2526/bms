-- Operational filters and safe recipient selection for branch requisitions (10.87 required).
BEGIN;
-- Follow 8.4: never grant password/token columns to the tenant role.
GRANT SELECT (language,pos_only) ON users TO bms_app;
GRANT SELECT (id,user_id,entity_type,entity_id,data,created_at) ON notifications TO bms_app;
CREATE INDEX IF NOT EXISTS bms_requisitions_need_by
  ON bms_branch_requisitions(tenant_id,location_id,needed_on,status);
CREATE INDEX IF NOT EXISTS bms_requisition_personal_notices
  ON notifications(user_id,created_at DESC,id DESC) WHERE entity_type='bms_requisition_action';
COMMIT;
-- ROLLBACK: revert operational UI/notification producers first. Keep persisted notices and grants;
-- other services may use these safe columns. No inventory trigger or business state is changed.
