-- =============================================================
-- 7.54  permission ใหม่: report.email
-- -------------------------------------------------------------
-- แยกจาก report.view เดิม (Sales/Manager/Administrator มีอยู่แล้ว) เพราะ
-- "ส่งรายงานออกไปเป็นอีเมลไปยังปลายทางใดก็ได้" เสี่ยงกว่าการดู/ดาวน์โหลดรายงาน
-- ภายในระบบมาก — ปลายทางมักมาจากข้อความอิสระที่ผู้ใช้พิมพ์ (ดู
-- lib/bms/tools/catalog.ts's email_report tool, A3/sensitive เสมอ) จึงให้เฉพาะ
-- Manager + Administrator เหมือน pattern ของ coupon.manage (7.21) ไม่ให้ Sales/Warehouse
-- (Administrator เป็น super ในโค้ดอยู่แล้ว ไม่ต้อง seed)
-- =============================================================

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'report.email')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
