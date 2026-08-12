-- =============================================================
-- 7.78  BMS RBAC — user.view / user.manage: ให้ Manager จัดการทีมงานร้านตัวเองได้
-- -------------------------------------------------------------
-- เดิม user CRUD gate ด้วย `ctx.admin.role === "Administrator"` เทียบ string ตรง ๆ
-- (คนละกลไกกับโมดูลอื่นที่ใช้ requirePermission) → เจ้าของร้านที่เป็น Manager
-- ต้องรบกวน platform admin ทุกครั้งที่จะเพิ่ม/ลบพนักงาน
--
-- • Administrator = super ในโค้ด (loadPermissions) → **ไม่ต้อง seed**
--   ถ้า seed ไปจะขัดกับ setRolePermissions() ที่ปฏิเสธการแก้สิทธิ์ Administrator
-- • CROSS JOIN bms_tenants = ร้านที่มีอยู่ทุกร้านได้สิทธิ์ ไม่งั้น Manager โดน 403 ทั้งระบบ
-- • ตั้งใจ **ไม่** seed ให้ Sales/Warehouse — Administrator ของแต่ละร้านเปิดให้เองได้
--   ที่ /admin/permissions ถ้าต้องการ
-- • ยังมี rank guard อีกชั้น (apps/web/lib/bms/staffRoles.ts + userAdmin.ts):
--   มีสิทธิ์นี้แล้วก็ยังแตะ Administrator / Manager คนอื่น / platform admin ไม่ได้
--   และ assign role ที่สูงกว่าหรือเท่ากับตัวเองไม่ได้
-- • idempotent — PK (tenant_id, role_id, permission)
--
-- ปิดฟีเจอร์ทันทีโดยไม่ต้อง deploy: ติ๊ก user.manage ออกที่ /admin/permissions
-- หรือ DELETE FROM bms_role_permissions WHERE permission LIKE 'user.%';
-- แล้ว gate จะกลับไปเป็น Administrator/platform admin เท่านั้นเหมือนเดิม
-- =============================================================

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  -- Manager: ดูรายชื่อ + เพิ่ม/แก้/ลบทีมงานที่ role ต่ำกว่าตัวเอง (Sales/Warehouse/Staff/Subscriber)
  ('Manager','user.view'),('Manager','user.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
