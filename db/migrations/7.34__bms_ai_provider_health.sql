-- =============================================================
-- 7.34  BMS AI Provider Health — สถานะเชื่อมต่อจริงของ shared AI provider
-- -------------------------------------------------------------
-- เหมือน 6.4__bms_channel_health.sql แต่สำหรับ shared AI provider (Anthropic/
-- DeepSeek/Qwen OCR) แทนช่องทางแชท — platform-wide ไม่ผูก tenant (คนละมิติกับ
-- BYOK ของแต่ละร้านใน bms_tenant_ai_config; ตารางนี้ตามด้วยเจตนาว่า "key กลาง
-- ของแพลตฟอร์มยังเชื่อมต่อได้จริงไหม" เท่านั้น ไม่ track BYOK ของร้าน)
--
-- provider+purpose เป็น composite key เพราะ provider เดียวรับใช้ได้มากกว่า 1
-- purpose (เช่น Anthropic ใช้ได้ทั้ง chat tool-calling และ slip OCR ถ้า
-- BMS_SLIP_READER_PROVIDER=anthropic) และแต่ละ purpose ก็ error ได้อิสระจากกัน
--
-- ไม่มี RLS/tenant_id (ตามแบบ bms_plans) เพราะเป็นข้อมูลระดับแพลตฟอร์ม ไม่ใช่
-- ข้อมูลของร้านใดร้านหนึ่ง
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_ai_provider_health (
  provider          TEXT NOT NULL CHECK (provider IN ('anthropic', 'deepseek', 'qwen')),
  purpose           TEXT NOT NULL CHECK (purpose IN ('chat', 'ocr')),
  status            TEXT NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN (
      'connected',      -- เรียกจริง/ทดสอบล่าสุดสำเร็จ
      'token_expired',  -- โดน 401/403 จาก provider
      'rate_limited',   -- โดน 429 จาก provider
      'send_failed',    -- error อื่น (network/timeout/5xx/malformed output)
      'unconfigured'    -- ยังไม่มี key ให้ตั้งค่านี้เลย
    )),
  status_detail     TEXT,
  last_error_at     TIMESTAMPTZ,
  last_success_at   TIMESTAMPTZ,
  last_checked_at   TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, purpose)
);

INSERT INTO bms_ai_provider_health (provider, purpose) VALUES
  ('anthropic', 'chat'),
  ('deepseek',  'chat'),
  ('anthropic', 'ocr'),
  ('qwen',      'ocr')
ON CONFLICT (provider, purpose) DO NOTHING;

CREATE TABLE IF NOT EXISTS bms_ai_provider_health_log (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_ai_provider_health_log_provider_purpose
  ON bms_ai_provider_health_log(provider, purpose, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE ON bms_ai_provider_health TO bms_app;
GRANT SELECT, INSERT ON bms_ai_provider_health_log TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
