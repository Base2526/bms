-- Variant-specific N-for-price rules; existing NULL retains all-variant behavior.
BEGIN;
ALTER TABLE bms_product_promotions DROP CONSTRAINT IF EXISTS bms_product_promotions_gift_shape;
ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_product_promotions_gift_shape CHECK (
  (kind='BUY_A_GET_B' AND get_qty IS NOT NULL AND bundle_price IS NULL
    AND buy_size IS NOT NULL AND length(btrim(buy_size))>0
    AND gift_sku IS NOT NULL AND gift_sku<>product_sku AND gift_size IS NOT NULL AND length(btrim(gift_size))>0)
  OR (kind='BUY_X_GET_Y' AND get_qty IS NOT NULL AND bundle_price IS NULL
    AND buy_size IS NULL AND gift_sku IS NULL AND gift_size IS NULL)
  OR (kind='N_FOR_PRICE' AND bundle_price IS NOT NULL AND get_qty IS NULL
    AND (buy_size IS NULL OR length(btrim(buy_size))>0) AND gift_sku IS NULL AND gift_size IS NULL)
);
ALTER TABLE bms_product_promotions ADD COLUMN IF NOT EXISTS sales_surface TEXT;
ALTER TABLE bms_product_promotions DROP CONSTRAINT IF EXISTS bms_product_promotions_sales_surface_check;
ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_product_promotions_sales_surface_check
  CHECK (sales_surface IS NULL OR sales_surface IN ('RETAIL_POS','RESTAURANT_POS','ONLINE_ORDER'));
COMMIT;
-- Rollback: deactivate/review variant N_FOR_PRICE rules before restoring the 10.41 shape.
