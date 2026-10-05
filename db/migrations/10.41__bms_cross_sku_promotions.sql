-- Explicit variant-to-variant gifts. Sale-time rules stay in pricing_snapshot.
ALTER TABLE bms_product_promotions
  ADD COLUMN IF NOT EXISTS buy_size TEXT,
  ADD COLUMN IF NOT EXISTS gift_sku TEXT,
  ADD COLUMN IF NOT EXISTS gift_size TEXT;

ALTER TABLE bms_product_promotions DROP CONSTRAINT IF EXISTS bms_product_promotions_kind_check;
ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_product_promotions_kind_check
  CHECK (kind IN ('BUY_X_GET_Y', 'N_FOR_PRICE', 'BUY_A_GET_B'));

-- Replace only the legacy kind/quantity combination check, never the date or quantity checks.
DO $$ DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'bms_product_promotions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%bundle_price IS NULL%'
      AND pg_get_constraintdef(oid) LIKE '%get_qty IS NULL%'
  LOOP EXECUTE format('ALTER TABLE bms_product_promotions DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE bms_product_promotions DROP CONSTRAINT IF EXISTS bms_product_promotions_gift_shape;
ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_product_promotions_gift_shape CHECK (
  (kind = 'BUY_A_GET_B' AND get_qty IS NOT NULL AND bundle_price IS NULL
    AND buy_size IS NOT NULL AND length(btrim(buy_size)) > 0
    AND gift_sku IS NOT NULL AND gift_sku <> product_sku
    AND gift_size IS NOT NULL AND length(btrim(gift_size)) > 0)
  OR (kind = 'BUY_X_GET_Y' AND get_qty IS NOT NULL AND bundle_price IS NULL
    AND buy_size IS NULL AND gift_sku IS NULL AND gift_size IS NULL)
  OR (kind = 'N_FOR_PRICE' AND bundle_price IS NOT NULL AND get_qty IS NULL
    AND buy_size IS NULL AND gift_sku IS NULL AND gift_size IS NULL)
);
ALTER TABLE bms_product_promotions DROP CONSTRAINT IF EXISTS bms_product_promotions_gift_product_fk;
ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_product_promotions_gift_product_fk
  FOREIGN KEY (tenant_id, gift_sku) REFERENCES bms_products(tenant_id, sku);
