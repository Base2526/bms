-- 9.52 NON_STOCK stock policy
--
-- Small restaurants could not publish their first menu item without creating an
-- ingredient per component and filling a recipe for every variant (RECIPE_REQUIRED).
-- NON_STOCK sells immediately and consumes no ingredient stock at all; per-dish cost
-- comes from bms_products.cost_price. A shop upgrades to RECIPE later from
-- /admin/stock-models without losing data.
--
-- No new table, permission, capability or RLS policy: everything reuses 9.40. The view's
-- GRANT is restated below because DROP VIEW discards it.

BEGIN;

-- ---- 1. Accept the new policy code ---------------------------------
-- 9.40 declared the CHECK inline, so the name is Postgres-generated. Resolve it
-- from the catalog instead of trusting the default name.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'bms_product_stock_policies'::regclass
     AND c.contype = 'c'
     AND a.attname = 'stock_policy'
     -- Narrow to the value list only. Other CHECKs on this table also mention
     -- stock_policy (scale_mapping_check pairs it with base_unit); dropping one of
     -- those would silently remove an unrelated guard.
     AND array_length(c.conkey, 1) = 1
     AND pg_get_constraintdef(c.oid) LIKE '%DIRECT%'
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE bms_product_stock_policies DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE bms_product_stock_policies
  ADD CONSTRAINT bms_product_stock_policies_stock_policy_check
  CHECK (stock_policy IN (
    'DIRECT', 'PACK', 'BUNDLE', 'WEIGHTED', 'RECIPE', 'SERIALIZED', 'NON_STOCK'
  ));

-- ---- 2. Keep NON_STOCK out of the legacy fallback branch -----------
-- resolveStockConsumptionInTx() returns zero consumption lines for NON_STOCK, so
-- snapshotOrderItemConsumptionInTx() writes no rows into
-- bms_order_item_stock_consumption. Without this predicate the view would read the
-- absent snapshot as "pre-9.40 row" and expand a NON_STOCK menu item into "consumes
-- 1 unit of itself" — against an inventory row that is deliberately pinned at 0,
-- which fails every sale (INSUFFICIENT) or trips CHECK (current_stock >= 0).
-- Only the second branch changes; branches 1 and 3 are copied verbatim from 9.40.
DROP VIEW IF EXISTS bms_order_stock_lines;
CREATE VIEW bms_order_stock_lines AS
  SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
         c.product_sku, c.size, c.qty
    FROM bms_order_items oi
    JOIN bms_order_item_stock_consumption c
      ON c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         oi.product_sku, oi.size, oi.qty
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
    LEFT JOIN bms_product_stock_policies sp
      ON sp.tenant_id = oi.tenant_id AND sp.product_sku = oi.product_sku
   WHERE p.is_bundle IS NOT TRUE
     AND COALESCE(sp.stock_policy, 'DIRECT') <> 'NON_STOCK'
     AND NOT EXISTS (
       SELECT 1 FROM bms_order_item_stock_consumption c
        WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
     )
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         b.component_sku, b.component_size, (oi.qty * b.qty)::integer
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku AND p.is_bundle
    JOIN bms_product_bundle_items b
      ON b.tenant_id = oi.tenant_id AND b.bundle_sku = oi.product_sku
   WHERE NOT EXISTS (
       SELECT 1 FROM bms_order_item_stock_consumption c
        WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
     );

-- DROP VIEW discards the view's ACL, so the grant must be restated on every
-- recreation (as 8.8, 9.3 and 9.40 each did). Without it every write path that
-- reads stock lines under `SET LOCAL ROLE bms_app` fails with 42501.
GRANT SELECT ON bms_order_stock_lines TO bms_app;

COMMENT ON VIEW bms_order_stock_lines IS
  'Immutable stock effects per sold line. New rows use 9.40 snapshots; legacy rows retain direct/bundle expansion. NON_STOCK products are excluded from the legacy fallback branch because they intentionally have zero consumption lines (9.52).';

COMMIT;
