-- 10.123: keep exact-identity history lookups bounded as audit rows accumulate.
-- The text actor remains necessary for older rows and services without actor_user_id.
-- ROLLBACK: DROP INDEX IF EXISTS idx_bms_audit_legacy_actor_time;
-- Creating this index scans bms_audit_log. Schedule the migration before the table is
-- very large, or use an operator-managed concurrent build for an already large database.

CREATE INDEX IF NOT EXISTS idx_bms_audit_legacy_actor_time
  ON bms_audit_log (tenant_id, actor, created_at DESC, id DESC)
  WHERE actor_user_id IS NULL AND actor IS NOT NULL;
