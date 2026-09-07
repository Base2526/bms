-- Receive demand before stock reservation. Only a human review creates a normal order.
-- CREATE TABLE IF NOT EXISTS means re-applying this file never alters an existing table: a
-- database that took an earlier copy of 9.66 keeps whatever foreign keys it was created
-- with. Check bms_restaurant_order_requests_tenant_id_fkey has ON DELETE CASCADE before
-- trusting a purge there; nothing else in this file needs a rewrite.
ALTER TABLE bms_orders ADD COLUMN IF NOT EXISTS restaurant_request_instructions text
  CHECK (length(restaurant_request_instructions) <= 1000);
CREATE TABLE IF NOT EXISTS bms_restaurant_order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE like every tenant table since 5.1: without it deleting a test shop
  -- fails on this table alone. The other three parents stay RESTRICT on purpose — a request
  -- is the evidence of what the customer asked for, and one that cannot say which order,
  -- customer or reviewer it belongs to answers nothing (same call as 9.29). ON DELETE SET
  -- NULL is not an option for any of them: order_id would break
  -- CHECK ((status = 'CONFIRMED') = (order_id IS NOT NULL)), and reviewed_by would fire the
  -- BEFORE UPDATE trigger below and make deleting a user fail on every closed request
  -- (the 9.25 -> 9.28 trap). Purge paths delete this table first; see deleteTenantRows().
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES bms_customers(id),
  channel text NOT NULL,
  customer_ref text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','CONTACTING','CONFIRMED','CANCELLED')),
  fingerprint text NOT NULL,
  source_key text NOT NULL,
  requested_items jsonb NOT NULL CHECK (jsonb_typeof(requested_items) = 'array' AND jsonb_array_length(requested_items) BETWEEN 1 AND 20),
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('DELIVERY','PICKUP')),
  requested_at timestamptz,
  request_note text NOT NULL DEFAULT '' CHECK (length(request_note) <= 1000),
  coupon_code text,
  agreed_items jsonb,
  agreed_at timestamptz,
  review_note text,
  reviewed_by uuid REFERENCES users(id),
  review_key text,
  order_id uuid REFERENCES bms_orders(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, customer_ref, source_key),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),
  CHECK ((status = 'CONFIRMED') = (order_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bms_restaurant_order_requests_queue
  ON bms_restaurant_order_requests (tenant_id, location_id, status, created_at);
CREATE INDEX IF NOT EXISTS bms_restaurant_order_requests_customer
  ON bms_restaurant_order_requests (tenant_id, channel, customer_ref, created_at DESC);
ALTER TABLE bms_restaurant_order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_restaurant_order_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_order_requests_tenant ON bms_restaurant_order_requests;
CREATE POLICY restaurant_order_requests_tenant ON bms_restaurant_order_requests
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON bms_restaurant_order_requests TO bms_app;

CREATE OR REPLACE FUNCTION bms_preserve_restaurant_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.location_id, NEW.customer_id, NEW.channel, NEW.customer_ref,
      NEW.requested_items, NEW.fulfillment_type, NEW.requested_at, NEW.request_note,
      NEW.coupon_code, NEW.fingerprint, NEW.source_key)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.location_id, OLD.customer_id, OLD.channel, OLD.customer_ref,
      OLD.requested_items, OLD.fulfillment_type, OLD.requested_at, OLD.request_note,
      OLD.coupon_code, OLD.fingerprint, OLD.source_key) THEN
    RAISE EXCEPTION 'Original restaurant demand is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED','CANCELLED') THEN
    RAISE EXCEPTION 'Restaurant request is already closed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_restaurant_request ON bms_restaurant_order_requests;
CREATE TRIGGER preserve_restaurant_request BEFORE UPDATE ON bms_restaurant_order_requests
  FOR EACH ROW EXECUTE FUNCTION bms_preserve_restaurant_request();
