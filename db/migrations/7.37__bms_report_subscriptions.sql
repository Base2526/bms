-- =============================================================
-- 7.37  BMS Report Subscriptions — สรุปยอดขายรายวัน/สัปดาห์/เดือน
-- -------------------------------------------------------------
-- bms_report_subscriptions: ตั้งค่า 1 แถวต่อร้าน (เหมือน bms_store_profile) —
--   ความถี่ + เวลาส่ง + ช่องทาง (email/Slack/LINE) ต่อร้าน
-- bms_report_deliveries: log แบบ append-only (เหมือน bms_audit_log) — ต่อการส่ง
--   1 ครั้ง ต่อ 1 ช่องทาง เพื่อให้ platform admin เห็นประวัติส่งจริงราย tenant
-- ไม่มี permission ใหม่ — ตั้งค่าฝั่งร้านใช้ requireTenantAdmin() เดิม (เหมือน
-- bms_store_profile/bms_tenant_channels), ฝั่ง platform admin ใช้ requirePlatformAdmin() เดิม
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_report_subscriptions (
  tenant_id           UUID PRIMARY KEY REFERENCES bms_tenants(id) ON DELETE CASCADE,
  frequency           TEXT NOT NULL DEFAULT 'DAILY' CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
  send_hour           SMALLINT NOT NULL DEFAULT 8 CHECK (send_hour BETWEEN 0 AND 23),
  send_weekday        SMALLINT CHECK (send_weekday BETWEEN 0 AND 6),   -- ใช้เฉพาะ WEEKLY (0=อาทิตย์)
  send_day_of_month   SMALLINT CHECK (send_day_of_month BETWEEN 1 AND 28), -- ใช้เฉพาะ MONTHLY
  email_enabled       BOOLEAN NOT NULL DEFAULT true,
  recipient_email     TEXT,
  slack_enabled       BOOLEAN NOT NULL DEFAULT false,
  slack_webhook_url   TEXT,   -- เข้ารหัสด้วย lib/bms/crypto.ts เหมือน channel_secret
  line_enabled        BOOLEAN NOT NULL DEFAULT false,
  line_user_id        TEXT,   -- LINE user id ของแอดมิน (ไม่ใช่ของลูกค้า) — ส่งผ่าน push API ด้วย
                              -- access_token ของ LINE OA ร้านนั้นเอง (bms_tenant_channels)
  enabled             BOOLEAN NOT NULL DEFAULT false,
  last_sent_at        TIMESTAMPTZ,
  last_period_key     TEXT,   -- กันส่งซ้ำในช่วงเวลาเดียวกัน เช่น 'DAILY:2026-07-30'
  last_status         TEXT CHECK (last_status IN ('SUCCESS','PARTIAL','FAILED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_report_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  frequency     TEXT NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
  period_key    TEXT NOT NULL,
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('EMAIL','SLACK','LINE')),
  status        TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_report_deliveries_tenant ON bms_report_deliveries(tenant_id, created_at DESC);

-- ---- RLS (เหมือน 6.1/7.18) ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_report_subscriptions','bms_report_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_report_subscriptions, bms_report_deliveries TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
