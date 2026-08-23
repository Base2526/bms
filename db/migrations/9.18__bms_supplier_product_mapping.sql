-- =============================================================
-- 9.18 Supplier product mapping
-- -------------------------------------------------------------
-- Maps a supplier's product identity to the shop's authoritative
-- SKU + size. Purchase-order lines retain supplier-facing snapshots
-- so old documents remain readable after the mapping changes.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_suppliers_tenant_id_id_key'
  ) THEN
    ALTER TABLE bms_suppliers
      ADD CONSTRAINT bms_suppliers_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_supplier_products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  supplier_id           UUID NOT NULL,
  product_sku           TEXT NOT NULL,
  size                  TEXT NOT NULL,
  supplier_sku          TEXT NOT NULL CHECK (btrim(supplier_sku) <> ''),
  supplier_product_name TEXT,
  supplier_barcode      TEXT,
  last_unit_cost        NUMERIC(12,2) CHECK (last_unit_cost IS NULL OR last_unit_cost >= 0),
  pack_qty              INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty > 0),
  min_order_qty         INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  lead_time_days        INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES bms_suppliers(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  UNIQUE (tenant_id, supplier_id, product_sku, size)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_supplier_products_supplier_sku
  ON bms_supplier_products (tenant_id, supplier_id, lower(supplier_sku));
CREATE INDEX IF NOT EXISTS idx_bms_supplier_products_lookup
  ON bms_supplier_products (tenant_id, supplier_id, product_sku, size)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_bms_supplier_products_barcode
  ON bms_supplier_products (tenant_id, supplier_id, supplier_barcode)
  WHERE supplier_barcode IS NOT NULL AND active;

ALTER TABLE bms_purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_sku TEXT,
  ADD COLUMN IF NOT EXISTS supplier_product_name TEXT;

COMMENT ON TABLE bms_supplier_products IS
  'Supplier catalog identity mapped to the shop-owned SKU and size used by inventory';
COMMENT ON COLUMN bms_purchase_order_items.supplier_sku IS
  'Supplier SKU snapshot at PO creation; stock continues to use product_sku + size';
COMMENT ON COLUMN bms_purchase_order_items.supplier_product_name IS
  'Supplier product-name snapshot at PO creation';

ALTER TABLE bms_supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_supplier_products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_supplier_products_tenant_isolation ON bms_supplier_products;
CREATE POLICY bms_supplier_products_tenant_isolation ON bms_supplier_products
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_supplier_products TO bms_app;

SELECT public.create_revision_trigger('bms_supplier_products');
