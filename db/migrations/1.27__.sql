-- =========
-- 0) EXT (ถ้ายังไม่มี)
-- =========
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========
-- 1) ตารางเก็บเบอร์ที่ผู้ใช้บล็อก (ส่วนตัว)
-- =========
CREATE TABLE IF NOT EXISTS user_blocked_phones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  phone_normalized text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_user
  ON user_blocked_phones (user_id);

CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_norm
  ON user_blocked_phones (phone_normalized);

-- =========
-- 2) ตาราง summary แบบ community (ไม่ระบุตัวตน)
-- =========
CREATE TABLE IF NOT EXISTS scam_phones_summary (
  phone_normalized text PRIMARY KEY,
  blocked_by_count int NOT NULL DEFAULT 0,
  last_blocked_at  timestamptz,
  report_count     int NOT NULL DEFAULT 0,
  last_report_at   timestamptz,
  risk_level       int NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phones_summary_updated
  ON scam_phones_summary (updated_at);

-- =========
-- 3) (Optional) ตาราง report เบอร์ (ถ้าคุณมีอยู่แล้ว ข้ามได้)
-- =========
CREATE TABLE IF NOT EXISTS scam_phone_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  phone           text NOT NULL,
  phone_normalized text NOT NULL,
  category        text,
  note            text,
  client_id       uuid,
  device_model    text,
  os_version      text,
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_norm
  ON scam_phone_reports (phone_normalized);

CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_created
  ON scam_phone_reports (created_at);

-- =========
-- 4) Helper function: calc risk (ปรับสูตรได้)
-- =========
CREATE OR REPLACE FUNCTION calc_phone_risk(blocked_cnt int, report_cnt int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  score int;
BEGIN
  score := (blocked_cnt * 4) + (report_cnt * 6);
  IF score > 100 THEN score := 100; END IF;
  IF score < 0 THEN score := 0; END IF;
  RETURN score;
END;
$$;
