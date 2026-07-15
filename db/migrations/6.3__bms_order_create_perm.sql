-- =============================================================
-- 6.3  BMS RBAC — เติมสิทธิ์ order.create (ใหม่ สำหรับฟีเจอร์ "ซื้อซ้ำ")
-- (renumbered จาก 6.1 เดิม — ชนกับ 6.1__bms_inbox_assignment.sql ที่มาจากคนละ branch)
-- -------------------------------------------------------------
-- ก่อนหน้านี้ orders ถูกสร้างจาก AI pipeline/REST เท่านั้น ไม่มี permission gate
-- ตอนนี้ staff สร้างออร์เดอร์ใหม่เองได้ผ่านปุ่ม "ซื้อซ้ำ" (bmsReorderFromOrder)
-- → ต้อง seed สิทธิ์ให้ Manager/Sales ทุก tenant ไม่งั้นโดน 403 (ตาม pattern 5.7)
-- (Administrator เป็น super ในโค้ด ไม่ต้อง seed)
-- =============================================================

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','order.create'),
  ('Sales','order.create')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
