-- =============================================================
-- 7.92  BMS POS — role "Cashier" + บัญชีที่ใช้ได้เฉพาะหน้าร้าน
-- -------------------------------------------------------------
-- ต้องรัน 7.90 ก่อน (users.pos_pin_hash)
--
-- ปัญหาที่แก้: จอขายกันแคชเชียร์ออกจากสต๊อกได้อยู่แล้ว (หน้า /pos ไม่มีทาง
-- เข้าถึงสต๊อกเลย) แต่ "บัญชี" ที่ใช้กด PIN คือบัญชีเดียวกับที่ login เข้า
-- /admin ได้ → แคชเชียร์เปิดเบราว์เซอร์ที่ไหนก็ได้แล้วเห็นสต๊อก ต้นทุน ยอดขาย
-- ทั้งหมด · จอขายกันตรงนั้นไม่ได้เพราะมันคนละทางเข้า
--
-- แก้ 2 ชั้น:
--   1. role Cashier — มีเฉพาะสิทธิ์ที่ต้องใช้ขายหน้าร้าน ไม่มี product.view /
--      stock.adjust / report.view → ต่อให้ login เข้าหลังบ้านได้ก็ไม่เห็นอะไร
--   2. users.pos_only — ปิดประตู /admin ตั้งแต่ต้น สำหรับพนักงานที่มีหน้าที่
--      คิดเงินอย่างเดียว (ยืนยันตัวตนด้วย PIN ที่เครื่อง ไม่ต้องมีรหัสผ่าน)
--
-- ทำไมต้องมีทั้งสองชั้น: role กันสิ่งที่ "เห็น" ส่วน pos_only กันการ "เข้า"
-- ร้านที่อยากให้หัวหน้ากะขายหน้าร้านด้วยและดูรายงานด้วย ใช้ role Cashier
-- ไม่ได้ → ต้องใช้ role อื่น + ไม่ตั้ง pos_only
--
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. role Cashier -------------------------------------------------
INSERT INTO roles (name, description) VALUES
  ('Cashier', 'แคชเชียร์ — ขายหน้าร้านและเปิด/ปิดกะเท่านั้น ไม่เห็นสต๊อก ต้นทุน หรือรายงาน')
ON CONFLICT (name) DO NOTHING;

-- สิทธิ์ให้เท่าที่ต้องใช้จริงที่เคาน์เตอร์ ไม่มีอะไรเกิน
-- ไม่ให้ pos.discount.approve — ส่วนลดต้องให้หัวหน้ามากด (ตามที่ตกลงไว้)
-- ไม่ให้ product.view — จอขายถามราคาผ่าน device token ไม่ได้ผ่าน permission ของคน
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Cashier','pos.sell'),
  ('Cashier','pos.shift.open'),
  ('Cashier','pos.shift.close')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- 2. บัญชีเฉพาะหน้าร้าน ------------------------------------------
-- TRUE = login เข้า /admin ไม่ได้เลย ไม่ว่าจะรู้รหัสผ่านหรือไม่
-- (loginAdmin ปฏิเสธตั้งแต่ก่อนตรวจรหัสผ่าน — ดู graphql/resolvers.ts)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.pos_only IS
  'TRUE = ใช้ได้เฉพาะที่เครื่องขายหน้าร้านด้วย PIN · login เข้าหลังบ้านไม่ได้';

CREATE INDEX IF NOT EXISTS idx_users_pos_only
  ON users (tenant_id) WHERE pos_only;

-- ---- 3. permission จัดการบัญชีหน้าร้าน -------------------------------
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.staff.manage'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
