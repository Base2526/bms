-- =============================================================
-- 9.1  สิทธิ์จัดการสาขา (location.manage)
-- -------------------------------------------------------------
-- ตาราง bms_locations มีมาตั้งแต่ 7.84 แต่ไม่เคยมีทาง "สร้างสาขาใหม่" จาก
-- แอปเลยสักจุด — มีแต่อ่าน (bmsLocations query) ใช้ประกอบ dropdown ที่อื่น
-- migration นี้แค่เพิ่ม permission ใหม่ ไม่แตะ schema ของ bms_locations
-- (ตารางพร้อมอยู่แล้วตั้งแต่ 7.84 ไม่มีอะไรต้องเปลี่ยน)
--
-- ให้ Manager เท่านั้น: การเพิ่ม/แก้สาขาเป็นการเปลี่ยนโครงสร้างร้าน
-- (ผูกกับใบกำกับภาษี/ใบอนุญาตขายยา/การตัดสต็อก) ไม่ใช่งานประจำวันของ
-- Sales/Warehouse — Administrator ได้อยู่แล้วในฐานะ super
--
-- รันซ้ำได้ปลอดภัย
-- =============================================================

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','location.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
