-- =============================================================
-- 4.2  BMS SaaS — Row-Level Security (ตาข่ายชั้น 2)
-- -------------------------------------------------------------
-- policy: ถ้า set GUC bms.tenant_id → บังคับ tenant_id ต้องตรง (enforce)
--         ถ้าไม่ได้ set → permissive (ไม่กระทบ read / base app / cron)
-- write-transaction ของ BMS จะ SET LOCAL bms.tenant_id → เขียนข้ามร้านไม่ได้
-- แม้ resolver จะลืม WHERE tenant_id
-- =============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_products','bms_inventory','bms_orders','bms_order_items',
                           'bms_stock_movements','bms_customers','bms_customer_identities','bms_customer_addresses']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;
