-- =============================================================
-- 5.6  BMS SaaS — Platform admin (เจ้าของแพลตฟอร์ม เหนือทุกร้าน)
-- -------------------------------------------------------------
-- • users.is_platform_admin — เห็น/จัดการ "ทุกร้าน" ต่างจาก Administrator
--   ที่เป็น super *ภายในร้านตัวเอง* เท่านั้น
-- • seed: Administrator ที่อยู่ร้าน default = platform admin ชุดแรก
--   (มีคนเข้าหน้า /admin/tenants ได้ทันทีหลัง migrate)
-- รันซ้ำได้ปลอดภัย
-- =============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- seed platform admin ชุดแรก = Administrator ของร้าน default
UPDATE users
   SET is_platform_admin = TRUE
 WHERE role = 'Administrator'
   AND tenant_id = '11111111-1111-1111-1111-111111111111'
   AND is_platform_admin = FALSE;

CREATE INDEX IF NOT EXISTS idx_users_platform_admin
  ON users(is_platform_admin) WHERE is_platform_admin;
