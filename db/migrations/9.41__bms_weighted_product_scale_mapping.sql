-- =============================================================
-- 9.41  Weighted-product scale mapping
-- -------------------------------------------------------------
-- Prefix 22 labels embed grams. The server maps the five-digit scale item code
-- to one configured inventory variant and re-parses the raw label at commit;
-- the browser never supplies authoritative weight or price.
-- =============================================================

ALTER TABLE bms_product_stock_policies
  ADD COLUMN IF NOT EXISTS scale_item_code TEXT,
  ADD COLUMN IF NOT EXISTS scale_size TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_product_stock_policies_scale_item_code_check'
       AND conrelid = 'bms_product_stock_policies'::regclass
  ) THEN
    ALTER TABLE bms_product_stock_policies
      ADD CONSTRAINT bms_product_stock_policies_scale_item_code_check
      CHECK (scale_item_code IS NULL OR scale_item_code ~ '^[0-9]{5}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_product_stock_policies_scale_mapping_check'
       AND conrelid = 'bms_product_stock_policies'::regclass
  ) THEN
    ALTER TABLE bms_product_stock_policies
      ADD CONSTRAINT bms_product_stock_policies_scale_mapping_check
      CHECK (
        (scale_item_code IS NULL AND scale_size IS NULL)
        OR (stock_policy = 'WEIGHTED' AND base_unit = 'GRAM'
            AND scale_item_code IS NOT NULL AND scale_size IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_stock_policies_scale_item
  ON bms_product_stock_policies (tenant_id, scale_item_code)
  WHERE scale_item_code IS NOT NULL;

COMMENT ON COLUMN bms_product_stock_policies.scale_item_code IS
  'Five digits embedded in a prefix-22 scale barcode; unique within one tenant.';
COMMENT ON COLUMN bms_product_stock_policies.scale_size IS
  'Exact bms_inventory.size receiving the grams embedded in the scale barcode.';
