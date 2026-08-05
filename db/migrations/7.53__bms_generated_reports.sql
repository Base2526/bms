-- =============================================================
-- 7.53  BMS AI Report & Document Generation — MVP core
-- -------------------------------------------------------------
-- Audit trail for on-demand generated reports (spec §11: who/when/filters/
-- destination/result). Append-only, same pattern as bms_audit_log/
-- bms_followup_history — one row per generation attempt.
--
-- file_id references the pre-existing `files` table (migration 1.6,
-- `id SERIAL`) — the same STORAGE_DIR/DB-row mechanism already used for
-- product images and chat attachments. Report files are served through a
-- NEW, tenant-gated route (app/api/bms/reports/download/[id]) rather than
-- the existing bare `/api/files/[id]`, which has no auth/tenant check at
-- all — acceptable for public product images, not acceptable for a
-- generated business report (revenue/profit/customer data).
--
-- No new permission — reuses the existing `report.view` (already granted
-- to Sales/Manager/Administrator, see 5.7).
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_generated_reports (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  report_type  TEXT NOT NULL CHECK (report_type IN ('SALES', 'INVENTORY', 'PROFIT')),
  format       TEXT NOT NULL CHECK (format IN ('XLSX', 'CSV', 'PDF')),
  params       JSONB NOT NULL DEFAULT '{}',
  file_id      INTEGER REFERENCES files(id) ON DELETE SET NULL,
  summary      TEXT,
  generated_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_generated_reports_tenant ON bms_generated_reports(tenant_id, created_at DESC);

-- ---- RLS (เหมือน 6.1) ----
ALTER TABLE bms_generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_generated_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_generated_reports_tenant_isolation ON bms_generated_reports;
CREATE POLICY bms_generated_reports_tenant_isolation ON bms_generated_reports
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_generated_reports TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
