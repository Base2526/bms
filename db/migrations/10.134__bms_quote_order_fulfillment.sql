-- A quote's site and retail pickup decision must survive conversion to an order.
-- Separate from restaurant fulfillment_type, which triggers kitchen work.
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS quote_site_address TEXT,
  ADD COLUMN IF NOT EXISTS retail_fulfillment_type TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_orders_retail_fulfillment_type_chk') THEN
    ALTER TABLE bms_orders ADD CONSTRAINT bms_orders_retail_fulfillment_type_chk
      CHECK (retail_fulfillment_type IS NULL OR retail_fulfillment_type IN ('PICKUP','DELIVERY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_orders_quote_site_address_chk') THEN
    ALTER TABLE bms_orders ADD CONSTRAINT bms_orders_quote_site_address_chk
      CHECK (quote_site_address IS NULL OR length(trim(quote_site_address)) BETWEEN 1 AND 1000);
  END IF;
END $$;

COMMENT ON COLUMN bms_orders.quote_site_address IS
  'Immutable site-address snapshot from an accepted quotation. No fallback to the CRM default shipping address.';
COMMENT ON COLUMN bms_orders.retail_fulfillment_type IS
  'Retail quotation pickup/delivery; distinct from restaurant fulfillment_type and kitchen acceptance.';
