-- =============================================================
-- 6.4  BMS Channel Health — สถานะเชื่อมต่อจริงของแต่ละช่องทาง
-- -------------------------------------------------------------
-- เดิม bms_tenant_channels มีแค่ active (BOOLEAN) = admin เปิด/ปิดเอง
--   ไม่มีที่เก็บว่า "เปิดอยู่แต่ใช้งานไม่ได้จริง" (token หมดอายุ/webhook verify
--   fail/rate limited/ไม่มี event เข้านานผิดปกติ) — ฟีเจอร์ Channel Health Status
--   ต้องแยก 2 มิตินี้ออกจากกัน: active (สวิตช์ที่ admin กด) vs status (สุขภาพจริง)
-- status ครอบคลุมเฉพาะ "ไม่ปกติหลังตั้งค่าแล้ว" — ตอนยังไม่กรอก token เลยยังคง
--   ดูจาก access_token/channel_secret เป็น NULL ที่ชั้น service เดิม (ไม่ต้องมี
--   status แยกว่า unconfigured ซ้ำ)
-- last_inbound_event_at / last_outbound_success_at แยกกัน เพราะ TikTok/Shopee/
--   Lazada รับ event ได้แต่ยังส่งไม่ได้ (roadmap) — "เขียว" ของแต่ละทิศทางไม่เท่ากัน
-- bms_channel_health_log = ประวัติเปลี่ยนสถานะ ใช้ debug/audit แยกจาก bms_audit_log
--   เดิม (ซึ่งเป็น action ของ user ไม่ใช่ event อัตโนมัติจากภายนอก)
-- =============================================================

ALTER TABLE bms_tenant_channels
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN (
      'connected',        -- verify/ping ปกติ
      'token_expired',    -- Send API โดน 401/403 จาก platform
      'webhook_failed',   -- signature verify ไม่ผ่านที่ webhook endpoint เราเอง
      'rate_limited',     -- โดน 429 จาก platform ต่อเนื่อง
      'no_events',        -- config ถูกแต่ไม่มี event เข้าเกิน X วัน
      'send_failed'       -- รับ event เข้าได้ปกติ แต่ตอบกลับ/ส่งออกไม่ได้ (partial degradation)
    )),
  ADD COLUMN IF NOT EXISTS status_detail TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bms_channel_health_log (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_channel_health_log_tenant_channel
  ON bms_channel_health_log(tenant_id, channel, occurred_at DESC);

-- ---- RLS (เหมือน 6.1/6.2) ----
ALTER TABLE bms_channel_health_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_channel_health_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_channel_health_log_tenant_isolation ON bms_channel_health_log;
CREATE POLICY bms_channel_health_log_tenant_isolation ON bms_channel_health_log
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_channel_health_log TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
