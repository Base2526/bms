-- =============================================================
-- 9.22  Order-item receipt/list-price snapshot
-- -------------------------------------------------------------
-- unit_price is the effective price used by order arithmetic.  A wholesale
-- rule can therefore turn a size price of 1,000 into 900.  The POS receipt
-- shown immediately after the sale still has the 1,000 price in its cart,
-- but a later reprint previously had only unit_price and displayed 900 as if
-- the product's price had changed.
--
-- receipt_unit_price is the immutable display price before wholesale/promo
-- rules and before order-level discounts.  Fixed-price packs snapshot their
-- pack price because that is their advertised selling-unit price.
-- =============================================================

ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS receipt_unit_price NUMERIC(12,2)
    CHECK (receipt_unit_price IS NULL OR receipt_unit_price >= 0);

-- Legacy rows did not preserve the pre-rule price.  Capture the best evidence
-- available at migration time once; future product edits cannot change it.
-- The effective historical unit_price is the final fallback, so every row can
-- be made NOT NULL even when an old product/pack record is incomplete.
UPDATE bms_order_items oi
   SET receipt_unit_price = COALESCE(
     oi.pack_unit_price,
     (
       SELECT sized.price
         FROM bms_product_packs sized
        WHERE sized.tenant_id = oi.tenant_id
          AND sized.product_sku = oi.product_sku
          AND sized.size = oi.size
          AND sized.is_base
        ORDER BY sized.active DESC, sized.updated_at DESC, sized.id
        LIMIT 1
     ),
     (
       SELECT shared.price
         FROM bms_product_packs shared
        WHERE shared.tenant_id = oi.tenant_id
          AND shared.product_sku = oi.product_sku
          AND shared.size IS NULL
          AND shared.is_base
        ORDER BY shared.active DESC, shared.updated_at DESC, shared.id
        LIMIT 1
     ),
     (
       SELECT p.price
         FROM bms_products p
        WHERE p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
        LIMIT 1
     ),
     oi.unit_price
   )
 WHERE oi.receipt_unit_price IS NULL;

ALTER TABLE bms_order_items
  ALTER COLUMN receipt_unit_price SET NOT NULL;

COMMENT ON COLUMN bms_order_items.receipt_unit_price IS
  'Immutable selling-unit display price before wholesale/promotion and order-level discounts; used for receipt reprints';

