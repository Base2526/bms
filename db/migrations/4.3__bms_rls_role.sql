-- =============================================================
-- 4.3  BMS SaaS — role สำหรับให้ RLS มีผลจริง
-- -------------------------------------------------------------
-- app เป็น superuser → bypass RLS เสมอ
-- สร้าง role bms_app (ไม่ใช่ superuser, ไม่ bypassrls) แล้ว write-transaction
-- ของ BMS จะ SET LOCAL ROLE bms_app → RLS enforce เฉพาะช่วงทรานแซกชันนั้น
-- (revert อัตโนมัติเมื่อ COMMIT/ROLLBACK)
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_app') THEN
    CREATE ROLE bms_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- สิทธิ์ CRUD บนตาราง BMS
GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_products, bms_inventory, bms_orders, bms_order_items,
  bms_stock_movements, bms_customers, bms_customer_identities,
  bms_customer_addresses, bms_tenants, bms_tenant_channels, bms_role_permissions
  TO bms_app;

-- สิทธิ์ sequence (สำหรับ BIGSERIAL)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
