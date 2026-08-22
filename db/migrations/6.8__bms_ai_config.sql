-- =============================================================
-- 6.8  BMS AI config — free-tier quota (shared key) + BYOK ต่อร้าน
-- -------------------------------------------------------------
-- เดิม AI ใช้ ANTHROPIC_API_KEY เดียวจาก env ทั้งแพลตฟอร์ม (global,
--   ไม่มี quota) — ตอนนี้แยกเป็น:
--   1. bms_tenant_ai_config: ร้านใส่ API key ของตัวเองได้ (BYOK) — ใช้ก่อน
--      เสมอถ้ามี ไม่ติด quota กลาง (ร้านจ่ายเอง/รับผิดชอบเอง)
--   2. bms_plans.max_ai_messages_month: quota ต่อเดือนสำหรับร้านที่ยังไม่มี
--      key ตัวเอง (ใช้ shared key จาก env) — เกิน quota fallback เป็น
--      template ธรรมดา ไม่ error (ดู lib/bms/ai.ts)
--   3. bms_ai_usage_monthly: นับจำนวนครั้งที่ตอบผ่าน shared key ต่อเดือน
--      (นับเฉพาะ shared key — BYOK ไม่นับ ไม่ติด limit)
-- limit = -1 หมายถึงไม่จำกัด (ตาม convention เดิมของ bms_plans)
-- =============================================================

ALTER TABLE bms_plans ADD COLUMN IF NOT EXISTS max_ai_messages_month INTEGER NOT NULL DEFAULT -1;

UPDATE bms_plans SET max_ai_messages_month = 400  WHERE code = 'free'     AND max_ai_messages_month = -1;
UPDATE bms_plans SET max_ai_messages_month = 4000 WHERE code = 'pro'      AND max_ai_messages_month = -1;
UPDATE bms_plans SET max_ai_messages_month = -1   WHERE code = 'business';

-- ---- ร้านตั้ง API key ของตัวเอง (BYOK) — api_key เข้ารหัสด้วย BMS_SECRET_KEY เหมือน channel_secret ----
CREATE TABLE IF NOT EXISTS bms_tenant_ai_config (
  tenant_id         UUID PRIMARY KEY REFERENCES bms_tenants(id) ON DELETE CASCADE,
  api_key_encrypted TEXT,
  model             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bms_tenant_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_tenant_ai_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_tenant_ai_config_tenant_isolation ON bms_tenant_ai_config;
CREATE POLICY bms_tenant_ai_config_tenant_isolation ON bms_tenant_ai_config
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- นับการใช้งาน AI ต่อเดือนต่อร้าน (เฉพาะที่ตอบผ่าน shared key) ----
CREATE TABLE IF NOT EXISTS bms_ai_usage_monthly (
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  year_month  TEXT NOT NULL, -- 'YYYY-MM' (UTC)
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year_month)
);

ALTER TABLE bms_ai_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_usage_monthly FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_ai_usage_monthly_tenant_isolation ON bms_ai_usage_monthly;
CREATE POLICY bms_ai_usage_monthly_tenant_isolation ON bms_ai_usage_monthly
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_tenant_ai_config TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_usage_monthly TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
