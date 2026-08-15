-- =============================================================
-- 7.90  BMS POS — PIN พนักงานหน้าร้าน
-- -------------------------------------------------------------
-- ต้องรัน 7.87 ก่อน
--
-- ทำไมต้องมี: จอขายยืนยันตัวตนคนไม่ได้เลยตอนนี้ — device token บอกได้แค่ว่า
-- "นี่คือเครื่องของร้านนี้" ส่วนช่อง "ผู้ขาย" เป็น dropdown ที่ใครกดก็ได้
-- ซึ่งใช้สอบย้อนกลับไม่ได้จริง ถ้าเงินขาดแล้วทุกคนปฏิเสธ
--
-- PIN ไม่ใช่รหัสผ่าน: ใช้ยืนยันตัวตน "ที่เครื่องหน้าร้าน" เท่านั้น
-- เข้าระบบหลังบ้านด้วย PIN ไม่ได้ และ hash แยกจาก password_hash คนละคอลัมน์
-- (ตั้งใจไม่ยุ่งกับ password_hash เลย — ตาราง users ห้ามเปิด revision ด้วย
--  เพราะ to_jsonb(OLD) จะ snapshot รหัสผ่านลงตาราง revision)
--
-- ล็อกเมื่อกดผิดหลายครั้ง: เก็บตัวนับกับเวลาปลดล็อกไว้ที่ผู้ใช้
-- รันซ้ำได้ปลอดภัย
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_pin_hash        TEXT,
  ADD COLUMN IF NOT EXISTS pos_pin_set_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pos_pin_failures    INTEGER NOT NULL DEFAULT 0
    CHECK (pos_pin_failures >= 0),
  ADD COLUMN IF NOT EXISTS pos_pin_locked_until TIMESTAMPTZ;

-- คนที่ตั้ง PIN แล้วเท่านั้นที่ขึ้นในจอขาย
CREATE INDEX IF NOT EXISTS idx_users_pos_pin
  ON users (tenant_id) WHERE pos_pin_hash IS NOT NULL;

-- ---- permission ตั้ง/รีเซ็ต PIN ------------------------------------
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.pin.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
