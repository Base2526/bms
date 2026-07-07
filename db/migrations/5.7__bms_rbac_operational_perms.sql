-- =============================================================
-- 5.7  BMS RBAC — เติมสิทธิ์โมดูล operational ที่ขาด (idempotent)
-- -------------------------------------------------------------
-- seed เดิม (3.7) ทำก่อนโมดูล purchase/payment/shipping/inbox (5.2–5.5)
-- → Manager/Sales/Warehouse เลย "ไม่มีสิทธิ์" หน้าพวกนี้ → โดน 403
-- เติมสิทธิ์ให้ครบ "ทุกร้าน (ทุก tenant)" ทั้งที่มีอยู่และร้าน default
-- (Administrator เป็น super ในโค้ด ไม่ต้อง seed)
-- =============================================================

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  -- Manager: จัดการได้ทุกอย่าง (ครบทุกโมดูล)
  ('Manager','purchase.view'),('Manager','purchase.edit'),('Manager','purchase.receive'),('Manager','purchase.cancel'),
  ('Manager','payment.view'),('Manager','payment.submit'),('Manager','payment.confirm'),('Manager','payment.refund'),
  ('Manager','shipping.view'),('Manager','shipping.create'),('Manager','shipping.update'),
  ('Manager','inbox.view'),('Manager','inbox.reply'),('Manager','inbox.manage'),
  -- Sales: ขาย/ดูแลลูกค้า + รับชำระ + ตอบแชต + ดูจัดส่ง/จัดซื้อ (ไม่ยืนยัน/คืนเงิน, ไม่สร้างจัดส่ง)
  ('Sales','payment.view'),('Sales','payment.submit'),
  ('Sales','shipping.view'),
  ('Sales','inbox.view'),('Sales','inbox.reply'),
  ('Sales','purchase.view'),
  -- Warehouse: รับของ/จัดส่ง (จัดการ shipping เต็ม + รับ PO + ดูแชต)
  ('Warehouse','shipping.view'),('Warehouse','shipping.create'),('Warehouse','shipping.update'),
  ('Warehouse','purchase.view'),('Warehouse','purchase.receive'),
  ('Warehouse','inbox.view')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
