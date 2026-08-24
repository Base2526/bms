-- =============================================================
-- 9.19 Wholesale tier hardening
-- -------------------------------------------------------------
-- 9.17 introduced cross-variant percentage tiers. This follow-up
-- keeps reruns safe, rejects incomplete percentage rows at the DB
-- boundary, and retains enough precision for prices such as
-- 1,500 -> 1,300 (13.3333%, rounded to satang per unit).
-- =============================================================

-- Recover only partial-migration rows whose intended mode is unambiguous.
UPDATE bms_product_price_tiers
   SET scope = CASE
     WHEN unit_price IS NOT NULL AND discount_pct IS NULL THEN 'PER_VARIANT_FIXED'
     WHEN unit_price IS NULL AND discount_pct IS NOT NULL THEN 'CROSS_VARIANT_PERCENT'
     ELSE scope
   END
 WHERE scope IS NULL;

ALTER TABLE bms_product_price_tiers
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_scope_check,
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_value_check;

ALTER TABLE bms_product_price_tiers
  ALTER COLUMN scope SET DEFAULT 'PER_VARIANT_FIXED',
  ALTER COLUMN scope SET NOT NULL,
  ALTER COLUMN discount_pct TYPE NUMERIC(7,4)
    USING discount_pct::NUMERIC(7,4);

ALTER TABLE bms_product_price_tiers
  ADD CONSTRAINT bms_product_price_tiers_scope_check
    CHECK (scope IN ('PER_VARIANT_FIXED', 'CROSS_VARIANT_PERCENT')),
  ADD CONSTRAINT bms_product_price_tiers_value_check CHECK (
    (scope = 'PER_VARIANT_FIXED'
      AND unit_price IS NOT NULL
      AND unit_price >= 0
      AND discount_pct IS NULL)
    OR
    (scope = 'CROSS_VARIANT_PERCENT'
      AND unit_price IS NULL
      AND discount_pct IS NOT NULL
      AND discount_pct > 0
      AND discount_pct <= 100)
  );

COMMENT ON TABLE bms_product_price_tiers IS
  'Wholesale quantity steps per SKU: fixed price qualifies by SKU+size; percentage discount qualifies across all sizes';
COMMENT ON COLUMN bms_product_price_tiers.discount_pct IS
  'Percentage discount with four-decimal precision when scope=CROSS_VARIANT_PERCENT; null for fixed-price tiers';
