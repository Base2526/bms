-- =============================================================
-- 7.27  AI Credit data model — monthly quota + usage events + ledger
-- -------------------------------------------------------------
-- ยกระดับจากการนับ shared AI แค่ count/เดือน → มี data model สำหรับ:
--   1) monthly quota summary ต่อร้าน
--   2) usage events ราย request
--   3) credit ledger แบบ append-only
--
-- หมายเหตุ:
-- - ยังไม่รื้อ max_ai_messages_month เดิมทันที เพื่อ compatibility
-- - plan ใหม่ใช้ ai_credits_monthly เป็น quota หลักของ AI credit UI/ledger
-- - bms_ai_usage_monthly ถูก reuse เป็น monthly summary ต่อเนื่องจากของเดิม
-- =============================================================

ALTER TABLE bms_plans
  ADD COLUMN IF NOT EXISTS ai_credits_monthly INTEGER NOT NULL DEFAULT -1;

UPDATE bms_plans
   SET ai_credits_monthly = 1000
 WHERE code = 'free'
   AND ai_credits_monthly = -1;

UPDATE bms_plans
   SET ai_credits_monthly = 10000
 WHERE code = 'pro'
   AND ai_credits_monthly = -1;

UPDATE bms_plans
   SET ai_credits_monthly = -1
 WHERE code = 'business';

ALTER TABLE bms_ai_usage_monthly
  ADD COLUMN IF NOT EXISTS shared_requests INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS byok_requests INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_requests INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_granted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_bonus INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_adjusted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

UPDATE bms_ai_usage_monthly
   SET shared_requests = GREATEST(shared_requests, count),
       credits_consumed = GREATEST(credits_consumed, count)
 WHERE shared_requests = 0
    OR credits_consumed = 0;

CREATE TABLE IF NOT EXISTS bms_ai_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  year_month      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'shared',
  surface         TEXT NOT NULL DEFAULT 'customer',
  feature         TEXT NOT NULL DEFAULT 'customer_reply',
  channel         TEXT,
  provider        TEXT NOT NULL DEFAULT 'anthropic',
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'started',
  credits_used    INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  estimated_cost  NUMERIC(12,4) NOT NULL DEFAULT 0,
  error_message   TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_bms_ai_usage_events_source'
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_source
      CHECK (source IN ('shared','byok','none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_bms_ai_usage_events_surface'
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_surface
      CHECK (surface IN ('customer','staff','system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_bms_ai_usage_events_status'
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_status
      CHECK (status IN ('started','completed','failed','blocked','fallback'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_ai_usage_events_tenant_month
  ON bms_ai_usage_events(tenant_id, year_month, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_ai_usage_events_feature
  ON bms_ai_usage_events(tenant_id, feature, created_at DESC);

ALTER TABLE bms_ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_ai_usage_events_tenant_isolation ON bms_ai_usage_events;
CREATE POLICY bms_ai_usage_events_tenant_isolation ON bms_ai_usage_events
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

CREATE TABLE IF NOT EXISTS bms_ai_credit_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  year_month     TEXT NOT NULL,
  entry_type     TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_bms_ai_credit_ledger_entry_type'
  ) THEN
    ALTER TABLE bms_ai_credit_ledger
      ADD CONSTRAINT chk_bms_ai_credit_ledger_entry_type
      CHECK (entry_type IN ('grant','consume','topup','adjustment','refund','bonus'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_ai_credit_ledger_tenant_month
  ON bms_ai_credit_ledger(tenant_id, year_month, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ai_credit_ledger_monthly_grant
  ON bms_ai_credit_ledger(tenant_id, year_month, entry_type, reference_type, reference_id);

ALTER TABLE bms_ai_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_credit_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_ai_credit_ledger_tenant_isolation ON bms_ai_credit_ledger;
CREATE POLICY bms_ai_credit_ledger_tenant_isolation ON bms_ai_credit_ledger
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_usage_events TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_credit_ledger TO bms_app;

