-- =============================================================
-- 6.6  BMS RLS role + restore hardening
-- -------------------------------------------------------------
-- Plain pg_dump backups created with --no-owner/--no-privileges do not
-- contain cluster roles or object ACLs. Re-provision bms_app and all current
-- BMS grants so a restored database can run beginTenantTx() safely.
--
-- Also close the RLS gap on the three tenant-owned tables that predate the
-- per-module RLS pattern and were not included in migration 4.2.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_app') THEN
    CREATE ROLE bms_app NOLOGIN NOBYPASSRLS;
  END IF;

  -- The compose/runtime database user is named app. Membership is required
  -- when that role is later changed from superuser to a regular login role.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT bms_app TO app;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO bms_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_products,
  bms_inventory,
  bms_orders,
  bms_order_items,
  bms_stock_movements,
  bms_customers,
  bms_customer_identities,
  bms_customer_addresses,
  bms_tenants,
  bms_tenant_channels,
  bms_role_permissions,
  bms_audit_log,
  bms_suppliers,
  bms_purchase_orders,
  bms_purchase_order_items,
  bms_payments,
  bms_shipments,
  bms_conversations,
  bms_messages,
  bms_conversation_notes,
  bms_product_categories,
  bms_conversation_helpers,
  bms_customer_ai_summary,
  bms_channel_health_log,
  bms_product_images
TO bms_app;

GRANT SELECT ON bms_plans TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'bms_tenant_channels',
    'bms_role_permissions',
    'bms_audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      table_name || '_tenant_isolation',
      table_name
    );
    EXECUTE format($policy$
      CREATE POLICY %I ON %I
        USING (
          tenant_id = COALESCE(
            NULLIF(current_setting('bms.tenant_id', true), '')::uuid,
            tenant_id
          )
        )
        WITH CHECK (
          tenant_id = COALESCE(
            NULLIF(current_setting('bms.tenant_id', true), '')::uuid,
            tenant_id
          )
        )
    $policy$, table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;
