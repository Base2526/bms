-- =============================================================
-- 7.40  BMS Mail Log — เก็บทุกอีเมลที่ระบบสั่งส่งจริง (ทุกร้าน + ระบบ)
-- -------------------------------------------------------------
-- ก่อนหน้านี้ lib/mailer.ts log ผ่าน addLog() ("email" category) ลง system_logs
-- ธรรมดา ซึ่งไม่เก็บเนื้อหา (html/text) เลย และไม่ผูก tenant — super admin
-- อยากดู log อีเมลทั้งหมด (สำเร็จ/ผิดพลาด) พร้อม view เนื้อหาที่ส่งจริงไม่ได้
-- เพิ่มตารางเฉพาะทางแยกต่างหาก ไม่ใช้ system_logs (ออกแบบมาเก็บ event ทั่วไป
-- ไม่ใช่เก็บ HTML body ยาวๆ ต่อฉบับ)
--
-- append-only แบบเดียวกับ bms_audit_log/bms_report_deliveries — insert เท่านั้น
-- ไม่มี UPDATE (แก้ log ย้อนหลังไม่ได้โดยออกแบบ)
--
-- tenant_id NULLABLE เพราะอีเมลบางประเภทไม่มีร้านผูกอยู่เลย (auth.verify ของ
-- ผู้ใช้ community เดิม, support ticket, BMS test email จาก /admin/dev/sql-console,
-- หรืออีเมลยืนยันสมัครร้านที่ยัง "pending" ก่อนมี tenant จริง) — ทุกจุดที่มี
-- tenant_id ในสโคป (order notify, sales digest) จะส่งมาด้วย
--
-- ไม่มี RLS: หน้าเดียวที่อ่านตารางนี้คือ /admin/mail-log ซึ่ง gate ด้วย
-- requirePlatformAdmin() เท่านั้น (ไม่ใช่ self-service ต่อร้านแบบ
-- bms_report_deliveries) และ tenant_id ที่ NULLABLE ทำให้ pattern RLS เดิม
-- (COALESCE(NULLIF(current_setting(...),''), tenant_id) ) ใช้ไม่ได้ตรงๆ —
-- แถว tenant_id IS NULL จะเทียบเป็น NULL = NULL (unknown/false) แล้วหายไปจาก
-- ผลลัพธ์แม้ตอนไม่ได้ set GUC เลย ซึ่งผิดเจตนา (อยากให้ platform admin เห็น
-- ทุกแถวเสมอ) จึงปล่อยให้ authorization ทำที่ resolver ชั้นเดียวแทน
-- (เหมือน bms_ai_provider_health/bms_plans ที่ไม่มี RLS เพราะเป็นข้อมูล
-- ระดับแพลตฟอร์ม ไม่ใช่ per-tenant self-service)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_mail_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES bms_tenants(id) ON DELETE SET NULL,
  category      TEXT NOT NULL DEFAULT 'other'
                  CHECK (category IN ('digest', 'order', 'auth', 'support', 'test', 'other')),
  provider      TEXT NOT NULL CHECK (provider IN ('sendgrid', 'gmail')),
  to_email      TEXT NOT NULL,
  from_email    TEXT,
  subject       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('success', 'error')),
  message_id    TEXT,
  status_code   INT,
  error         TEXT,
  html          TEXT,
  text_body     TEXT,
  triggered_by  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_mail_log_created_at ON bms_mail_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_mail_log_tenant ON bms_mail_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_mail_log_status ON bms_mail_log (status);
CREATE INDEX IF NOT EXISTS idx_bms_mail_log_category ON bms_mail_log (category);

GRANT SELECT, INSERT ON bms_mail_log TO bms_app;
