-- =============================================================
-- 9.23  Re-evaluate quantity pricing after a POS partial return
-- -------------------------------------------------------------
-- A sale that qualified for wholesale pricing must not keep that price when
-- the retained quantity falls below the threshold.  The original sale/tax
-- document remains immutable; this snapshot is used only to price the basket
-- retained after a later return and to determine the refundable difference.
-- =============================================================

ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;

-- Historical rows did not preserve their rule set.  Capture the best evidence
-- available once.  This is deliberately a migration-time reconstruction;
-- future product-rule edits cannot change it again.
UPDATE bms_order_items oi
   SET pricing_snapshot = jsonb_build_object(
     'priceTiers', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'minQty', tier.min_qty,
         'scope', tier.scope,
         'size', tier.size,
         'unitPrice', tier.unit_price,
         'discountPct', tier.discount_pct
       ) ORDER BY tier.min_qty, tier.id)
         FROM bms_product_price_tiers tier
        WHERE tier.tenant_id = oi.tenant_id
          AND tier.product_sku = oi.product_sku
     ), '[]'::jsonb),
     'promotion', (
       SELECT CASE promo.kind
         WHEN 'BUY_X_GET_Y' THEN jsonb_build_object(
           'kind', promo.kind, 'buyQty', promo.buy_qty, 'getQty', promo.get_qty)
         WHEN 'N_FOR_PRICE' THEN jsonb_build_object(
           'kind', promo.kind, 'buyQty', promo.buy_qty, 'bundlePrice', promo.bundle_price)
         ELSE NULL
       END
         FROM bms_product_promotions promo
        WHERE promo.tenant_id = oi.tenant_id
          AND promo.product_sku = oi.product_sku
          AND promo.active
        ORDER BY promo.updated_at DESC, promo.id DESC
        LIMIT 1
     )
   )
 WHERE oi.pricing_snapshot IS NULL;

ALTER TABLE bms_order_items
  ALTER COLUMN pricing_snapshot SET DEFAULT '{"priceTiers":[],"promotion":null}'::jsonb,
  ALTER COLUMN pricing_snapshot SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_order_items_pricing_snapshot_object_check'
  ) THEN
    ALTER TABLE bms_order_items
      ADD CONSTRAINT bms_order_items_pricing_snapshot_object_check
      CHECK (jsonb_typeof(pricing_snapshot) = 'object');
  END IF;
END $$;

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS pricing_adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (pricing_adjustment_amount >= 0),
  ADD COLUMN IF NOT EXISTS remaining_amount_after_return NUMERIC(12,2)
    CHECK (remaining_amount_after_return IS NULL OR remaining_amount_after_return >= 0);

COMMENT ON COLUMN bms_order_items.pricing_snapshot IS
  'Immutable wholesale-tier/promotion rules at sale time; used to reprice retained quantities after POS returns';
COMMENT ON COLUMN bms_pos_returns.pricing_adjustment_amount IS
  'Refund reduction caused by loss/change of quantity-pricing eligibility after this return';
COMMENT ON COLUMN bms_pos_returns.remaining_amount_after_return IS
  'Net amount retained on the original sale after cumulative refunds including this return';
