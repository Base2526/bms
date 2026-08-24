-- =============================================================
-- 9.20 Size-specific fixed wholesale tiers
-- -------------------------------------------------------------
-- A fixed wholesale price can now target one inventory size. Legacy rows
-- keep size = NULL and continue to mean "all sizes use this fixed price".
-- Cross-variant percentage rules remain SKU-wide and therefore cannot carry
-- a size. Exact-size rules win deterministic ties in application pricing.
-- =============================================================

ALTER TABLE bms_product_price_tiers
  ADD COLUMN IF NOT EXISTS size TEXT;

ALTER TABLE bms_product_price_tiers
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_size_check,
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_value_check,
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_tenant_id_product_sku_min_qty_key;

ALTER TABLE bms_product_price_tiers
  ADD CONSTRAINT bms_product_price_tiers_size_check
    CHECK (size IS NULL OR btrim(size) <> ''),
  ADD CONSTRAINT bms_product_price_tiers_value_check CHECK (
    (scope = 'PER_VARIANT_FIXED'
      AND unit_price IS NOT NULL
      AND unit_price >= 0
      AND discount_pct IS NULL)
    OR
    (scope = 'CROSS_VARIANT_PERCENT'
      AND size IS NULL
      AND unit_price IS NULL
      AND discount_pct IS NOT NULL
      AND discount_pct > 0
      AND discount_pct <= 100)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_price_tiers_rule
  ON bms_product_price_tiers
    (tenant_id, product_sku, scope, COALESCE(size, ''), min_qty);

CREATE INDEX IF NOT EXISTS idx_bms_price_tiers_size_lookup
  ON bms_product_price_tiers (tenant_id, product_sku, size, min_qty);

COMMENT ON TABLE bms_product_price_tiers IS
  'Wholesale quantity steps per SKU: fixed price can target one size; percentage discount qualifies across all sizes';
COMMENT ON COLUMN bms_product_price_tiers.size IS
  'Target size for PER_VARIANT_FIXED; NULL means all sizes for legacy/shared fixed rules and is required for CROSS_VARIANT_PERCENT';
