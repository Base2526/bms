-- =============================================================
-- 9.97  Sale-time cost snapshots for trustworthy profit reports
-- -------------------------------------------------------------
-- Product prices already have immutable sale-time evidence, but historical
-- profit still joined today's bms_products.cost_price. Preserve the total cost
-- represented by each sold line so later catalog edits cannot rewrite history.
-- New orders use CATALOG_AT_SALE; old rows are explicitly marked as a migration-
-- time reconstruction and must never be presented as equally authoritative.
-- =============================================================

BEGIN;

ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS cost_amount_snapshot NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cost_snapshot_source TEXT;

-- Reconstruct legacy derived items from the same stock-effect view used by
-- reservation/return code. This preserves recipe, bundle, pack and modifier
-- quantities better than reading only the sold parent SKU's current cost.
WITH reconstructed AS (
  SELECT stock.order_item_id,
         COUNT(*) FILTER (WHERE product.cost_price IS NULL) AS missing_components,
         ROUND(SUM(stock.qty * product.cost_price), 2) AS total_cost
    FROM bms_order_stock_lines stock
    LEFT JOIN bms_products product
      ON product.tenant_id = stock.tenant_id AND product.sku = stock.product_sku
   GROUP BY stock.order_item_id
)
UPDATE bms_order_items item
   SET cost_amount_snapshot = CASE
         WHEN reconstructed.missing_components > 0 THEN NULL
         ELSE reconstructed.total_cost
       END,
       cost_snapshot_source = CASE
         WHEN reconstructed.missing_components > 0 THEN 'MISSING'
         ELSE 'LEGACY_CURRENT'
       END
  FROM reconstructed
 WHERE reconstructed.order_item_id = item.id
   AND item.cost_snapshot_source IS NULL;

-- NON_STOCK/service rows intentionally have no stock-consumption row. Fall back
-- to the sold SKU only for rows the stock-effect reconstruction did not cover.
UPDATE bms_order_items item
   SET cost_amount_snapshot = CASE
         WHEN product.cost_price IS NULL THEN NULL
         ELSE ROUND(item.qty * product.cost_price, 2)
       END,
       cost_snapshot_source = CASE
         WHEN product.cost_price IS NULL THEN 'MISSING'
         ELSE 'LEGACY_CURRENT'
       END
  FROM bms_products product
 WHERE product.tenant_id = item.tenant_id
   AND product.sku = item.product_sku
   AND item.cost_snapshot_source IS NULL;

UPDATE bms_order_items
   SET cost_snapshot_source = 'MISSING'
 WHERE cost_snapshot_source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_order_items_cost_snapshot_nonnegative_check'
  ) THEN
    ALTER TABLE bms_order_items
      ADD CONSTRAINT bms_order_items_cost_snapshot_nonnegative_check
      CHECK (cost_amount_snapshot IS NULL OR cost_amount_snapshot >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_order_items_cost_snapshot_source_check'
  ) THEN
    ALTER TABLE bms_order_items
      ADD CONSTRAINT bms_order_items_cost_snapshot_source_check
      CHECK (cost_snapshot_source IN ('CATALOG_AT_SALE', 'LEGACY_CURRENT', 'MISSING'));
  END IF;
END $$;

ALTER TABLE bms_order_items
  ALTER COLUMN cost_snapshot_source SET DEFAULT 'MISSING',
  ALTER COLUMN cost_snapshot_source SET NOT NULL;

COMMENT ON COLUMN bms_order_items.cost_amount_snapshot IS
  'Total component/catalog cost captured when the order line is created; NULL means at least one required cost was unknown.';
COMMENT ON COLUMN bms_order_items.cost_snapshot_source IS
  'CATALOG_AT_SALE is immutable evidence; LEGACY_CURRENT is migration-time reconstruction; MISSING is deliberately unknown, never zero.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_order_items DROP CONSTRAINT IF EXISTS bms_order_items_cost_snapshot_source_check;
-- ALTER TABLE bms_order_items DROP CONSTRAINT IF EXISTS bms_order_items_cost_snapshot_nonnegative_check;
-- ALTER TABLE bms_order_items DROP COLUMN IF EXISTS cost_snapshot_source;
-- ALTER TABLE bms_order_items DROP COLUMN IF EXISTS cost_amount_snapshot;
