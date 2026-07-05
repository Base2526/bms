-- =============================================================
-- 3.7  BMS RBAC — role_permissions + seed roles/สิทธิ์
-- -------------------------------------------------------------
-- Administrator = super (bypass ในโค้ด, ไม่ต้อง seed)
-- permission แบบ resource.action (นิยามหลักอยู่ใน lib/bms/permissions.ts)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_role_permissions (
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_bms_role_perms_role ON bms_role_permissions(role_id);

-- ---- seed roles ----
INSERT INTO roles (name, description) VALUES
  ('Manager',   'ผู้จัดการ — จัดการได้เกือบทุกอย่าง'),
  ('Sales',     'ฝ่ายขาย — ขาย/ดูแลลูกค้าได้ แต่แก้/ลบสินค้าไม่ได้'),
  ('Warehouse', 'คลังสินค้า — รับของ/จัดส่งได้ แต่ดูรายงานการเงินไม่ได้')
ON CONFLICT (name) DO NOTHING;

-- ---- seed permissions ต่อ role ----
-- helper: ใส่สิทธิ์ให้ role ตามชื่อ
INSERT INTO bms_role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  -- Manager: ทุกอย่าง
  ('Manager','product.view'),('Manager','product.edit'),('Manager','product.delete'),('Manager','stock.adjust'),
  ('Manager','order.view'),('Manager','order.pay'),('Manager','order.ship'),('Manager','order.cancel'),('Manager','order.return'),
  ('Manager','customer.view'),('Manager','customer.edit'),('Manager','report.view'),
  -- Sales: ขาย + ลูกค้า + ดูสินค้า/รายงาน (ห้ามแก้/ลบสินค้า, ห้ามปรับสต็อก, ห้ามจัดส่ง)
  ('Sales','product.view'),
  ('Sales','order.view'),('Sales','order.pay'),('Sales','order.cancel'),('Sales','order.return'),
  ('Sales','customer.view'),('Sales','customer.edit'),('Sales','report.view'),
  -- Warehouse: รับของ/จัดส่ง + ดูสินค้า (ห้ามดูรายงานการเงิน, ห้ามแก้/ลบสินค้า)
  ('Warehouse','product.view'),('Warehouse','stock.adjust'),
  ('Warehouse','order.view'),('Warehouse','order.ship')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (role_id, permission) DO NOTHING;
