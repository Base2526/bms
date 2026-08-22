-- =============================================================
-- 9.3 — Repair product-bundle schema on deployments that skipped 8.8
-- -------------------------------------------------------------
-- Some long-lived databases received the bundle-aware application code but
-- not migration 8.8. createOrder() loads bundle recipes for every order, so
-- even a basket containing only ordinary products then fails with:
--   relation "bms_product_bundle_items" does not exist
--
-- Keep this as a new, idempotent repair migration instead of changing 8.8:
-- 8.8 may already have been applied elsewhere. Repeating the complete bundle
-- schema here also repairs a partially applied migration (table present but
-- indexes, RLS, grants, or the stock-expansion view missing).
-- =============================================================

BEGIN;

ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_products.is_bundle IS
  'TRUE = สินค้าชุด ไม่มีสต็อกของตัวเอง ตัดจากส่วนประกอบใน bms_product_bundle_items (8.8; repaired by 9.3)';

CREATE TABLE IF NOT EXISTS bms_product_bundle_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bundle_sku      TEXT NOT NULL,
  component_sku   TEXT NOT NULL,
  component_size  TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bundle_sku, component_sku, component_size),
  FOREIGN KEY (tenant_id, bundle_sku)    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, component_sku) REFERENCES bms_products(tenant_id, sku),
  CHECK (bundle_sku <> component_sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_bundle_items_bundle
  ON bms_product_bundle_items (tenant_id, bundle_sku);
CREATE INDEX IF NOT EXISTS idx_bms_bundle_items_component
  ON bms_product_bundle_items (tenant_id, component_sku);

ALTER TABLE bms_product_bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_bundle_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_bundle_items_tenant_isolation ON bms_product_bundle_items;
CREATE POLICY bms_product_bundle_items_tenant_isolation ON bms_product_bundle_items
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_bundle_items TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- Stock settlement, cancellation, returns, and movement history all consume
-- this one expansion view. Do not fall back to bms_order_items when the table
-- is absent: that would let sales complete while deducting the wrong stock.
DROP VIEW IF EXISTS bms_order_stock_lines;
CREATE VIEW bms_order_stock_lines AS
  SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
         oi.product_sku, oi.size, oi.qty
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
   WHERE p.is_bundle IS NOT TRUE
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         b.component_sku, b.component_size, (oi.qty * b.qty)::integer
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku AND p.is_bundle
    JOIN bms_product_bundle_items b
      ON b.tenant_id = oi.tenant_id AND b.bundle_sku = oi.product_sku;

GRANT SELECT ON bms_order_stock_lines TO bms_app;

COMMENT ON VIEW bms_order_stock_lines IS
  'บรรทัดบิลที่แปลงเป็นของที่ขยับจริงในคลัง — เซ็ตถูกแทนด้วยส่วนประกอบ (8.8; repaired by 9.3) · ทุกที่ที่ขยับสต็อกต้องอ่านจากนี่';

COMMIT;
