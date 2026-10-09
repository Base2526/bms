-- Retain a refused call's requirement: positive dollars left need not fit that call.
ALTER TABLE bms_ai_usage_monthly
  ADD COLUMN IF NOT EXISTS budget_denied_required_usd NUMERIC(16,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_denied_model TEXT,
  ADD COLUMN IF NOT EXISTS budget_denied_provider TEXT;

CREATE TABLE IF NOT EXISTS bms_ai_limit_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('CREDITS','BUDGET')),
  level TEXT NOT NULL CHECK (level IN ('WARNING_80','WARNING_90','PAUSED','RESUMED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year_month, dimension, level)
);
ALTER TABLE bms_ai_limit_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_ai_limit_notices;
CREATE POLICY tenant_isolation ON bms_ai_limit_notices
  USING (tenant_id = current_setting('bms.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('bms.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON bms_ai_limit_notices TO bms_app;
-- Reuse the existing personal notification store. Services additionally check
-- both recipient and the RLS-protected notice's tenant for every read/ack.
GRANT SELECT (id,user_id,type,title,message,entity_type,entity_id,data,is_read,created_at),
      INSERT (id,user_id,type,title,message,entity_type,entity_id,data),
      UPDATE (is_read) ON notifications TO bms_app;
