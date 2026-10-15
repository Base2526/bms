BEGIN;
CREATE TABLE IF NOT EXISTS bms_inventory_values (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  qty BIGINT NOT NULL CHECK (qty >= 0),
  value NUMERIC(26,6) CHECK (value >= 0),
  version BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id,location_id,product_sku,size)
);
CREATE TABLE IF NOT EXISTS bms_inventory_value_entries (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  movement_id BIGINT NOT NULL,
  location_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  kind TEXT NOT NULL,
  qty BIGINT NOT NULL CHECK (qty > 0),
  amount NUMERIC(26,6) CHECK (amount >= 0),
  order_id UUID,
  order_item_id BIGINT,
  return_id UUID,
  transfer_item_id BIGINT,
  purchase_item_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,movement_id)
);
CREATE INDEX IF NOT EXISTS bms_inventory_value_order_idx ON bms_inventory_value_entries(tenant_id,order_id,order_item_id);
CREATE INDEX IF NOT EXISTS bms_inventory_value_transfer_idx ON bms_inventory_value_entries(tenant_id,transfer_item_id);
CREATE TABLE IF NOT EXISTS bms_inventory_value_openings (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  location_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  qty BIGINT NOT NULL CHECK (qty >= 0),
  value NUMERIC(26,6) NOT NULL CHECK (value >= 0),
  evidence TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_id)
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_inventory_values','bms_inventory_value_entries','bms_inventory_value_openings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=NULLIF(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
  END LOOP;
END $$;
GRANT UPDATE ON bms_inventory_values TO bms_app;
REVOKE UPDATE,DELETE ON bms_inventory_value_entries,bms_inventory_value_openings FROM bms_app;
COMMENT ON TABLE bms_inventory_values IS 'Per branch/SKU/variant moving weighted average. NULL value means unverified opening or receipt; no historical catalog backfill.';
COMMENT ON TABLE bms_inventory_value_entries IS 'Append-only physical stock valuation evidence in the movement transaction. Transfers carry cost; losses are separate from COGS. Six decimal THB conserved until report rounding.';
COMMIT;
-- ROLLBACK: revert application first; retain valuation evidence. No backfill or changes to historical movements.
