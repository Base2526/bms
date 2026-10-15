-- Apply before deploying the matching service. Existing tenant RLS/table grants are retained.
BEGIN;
ALTER TABLE bms_restaurant_check_items ADD COLUMN IF NOT EXISTS stock_snapshot JSONB;
ALTER TABLE bms_order_items ADD COLUMN IF NOT EXISTS restaurant_check_item_id UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_order_items_restaurant_item_fk'
    AND conrelid='bms_order_items'::regclass) THEN
    ALTER TABLE bms_order_items ADD CONSTRAINT bms_order_items_restaurant_item_fk
      FOREIGN KEY (tenant_id, restaurant_check_item_id) REFERENCES bms_restaurant_check_items(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_restaurant_item_snapshot_check'
    AND conrelid='bms_restaurant_check_items'::regclass) THEN
    ALTER TABLE bms_restaurant_check_items ADD CONSTRAINT bms_restaurant_item_snapshot_check
      CHECK (stock_snapshot IS NULL OR (jsonb_typeof(stock_snapshot)='object'
        AND stock_snapshot @> '{"version":1}'::jsonb));
  END IF;
END $$;
-- Restaurant lines remain separate across rounds/recipe versions. Retail's existing key is unchanged.
DROP INDEX IF EXISTS uq_bms_order_items_order_sku_size_pack;
CREATE UNIQUE INDEX uq_bms_order_items_order_sku_size_pack
  ON bms_order_items(order_id,product_sku,size,COALESCE(NULLIF(upper(btrim(pack_code)),''),'BASE'))
  WHERE restaurant_check_item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_order_items_restaurant_item
  ON bms_order_items(order_id,restaurant_check_item_id) WHERE restaurant_check_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_order_items_restaurant_item_tenant
  ON bms_order_items(tenant_id,restaurant_check_item_id) WHERE restaurant_check_item_id IS NOT NULL;

-- v2 records an explicit (possibly empty) consumption snapshot. Never expand it using today's policy.
CREATE OR REPLACE VIEW bms_order_stock_lines AS
  SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
         c.product_sku, c.size, c.qty
    FROM bms_order_items oi
    JOIN bms_order_item_stock_consumption c ON c.tenant_id=oi.tenant_id AND c.order_item_id=oi.id
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id, oi.product_sku, oi.size, oi.qty
    FROM bms_order_items oi
    JOIN bms_products p ON p.tenant_id=oi.tenant_id AND p.sku=oi.product_sku
    LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
   WHERE oi.stock_consumption_version < 2 AND p.is_bundle IS NOT TRUE
     AND COALESCE(sp.stock_policy,'DIRECT') <> 'NON_STOCK'
     AND NOT EXISTS (SELECT 1 FROM bms_order_item_stock_consumption c WHERE c.tenant_id=oi.tenant_id AND c.order_item_id=oi.id)
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id, b.component_sku, b.component_size, (oi.qty*b.qty)::integer
    FROM bms_order_items oi
    JOIN bms_products p ON p.tenant_id=oi.tenant_id AND p.sku=oi.product_sku AND p.is_bundle
    JOIN bms_product_bundle_items b ON b.tenant_id=oi.tenant_id AND b.bundle_sku=oi.product_sku
   WHERE oi.stock_consumption_version < 2
     AND NOT EXISTS (SELECT 1 FROM bms_order_item_stock_consumption c WHERE c.tenant_id=oi.tenant_id AND c.order_item_id=oi.id);
GRANT SELECT ON bms_order_stock_lines TO bms_app;
COMMENT ON COLUMN bms_restaurant_check_items.stock_snapshot IS
  'Immutable first-kitchen-send stock/cost evidence; follows whole-row split/merge. Legacy evidence is explicitly labelled, never reconstructed from current catalog.';
COMMENT ON COLUMN bms_order_items.restaurant_check_item_id IS
  'Tenant-scoped restaurant line identity; multiple rounds of the same menu must not merge consumption or cost evidence.';
COMMIT;
-- ROLLBACK: roll back application first. Do NOT drop snapshot columns or restore the old unique
-- index while orders contain multiple restaurant lines with the same SKU/size/pack.
-- Preserve v2 view semantics even after app rollback; otherwise empty snapshots start moving stock.
