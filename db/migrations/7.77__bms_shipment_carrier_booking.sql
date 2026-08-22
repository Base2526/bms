-- =============================================================
-- 7.77  BMS Shipping - reliable carrier booking state
-- -------------------------------------------------------------
-- Carrier calls happen outside database transactions. These fields retain a
-- retryable booking state, while the shipment UUID is the stable idempotency
-- key sent to the carrier adapter.
-- =============================================================

ALTER TABLE bms_shipments
  ADD COLUMN IF NOT EXISTS carrier_booking_status TEXT NOT NULL DEFAULT 'manual'
    CHECK (carrier_booking_status IN
      ('manual', 'ready', 'booking', 'booked', 'failed', 'unconfigured', 'not_implemented')),
  ADD COLUMN IF NOT EXISTS carrier_booking_error TEXT,
  ADD COLUMN IF NOT EXISTS carrier_booking_attempted_at TIMESTAMPTZ;

-- Replace the earlier lookup-only index: a carrier shipment may be linked to
-- only one local shipment in a tenant, including after an idempotent retry.
DROP INDEX IF EXISTS idx_bms_shipments_external_shipment_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_shipments_external_shipment_id
  ON bms_shipments(tenant_id, carrier, external_shipment_id)
  WHERE external_shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_shipments_carrier_booking
  ON bms_shipments(tenant_id, carrier_booking_status, carrier_booking_attempted_at)
  WHERE carrier_booking_status <> 'booked';

CREATE TABLE IF NOT EXISTS bms_shipment_tracking_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES bms_shipments(id) ON DELETE CASCADE,
  carrier_status TEXT NOT NULL,
  description TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'mock')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, carrier_status, occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_bms_shipment_tracking_events_timeline
  ON bms_shipment_tracking_events(tenant_id, shipment_id, occurred_at DESC);

ALTER TABLE bms_shipment_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_shipment_tracking_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bms_shipment_tracking_events_tenant_isolation
  ON bms_shipment_tracking_events;
CREATE POLICY bms_shipment_tracking_events_tenant_isolation
  ON bms_shipment_tracking_events
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_shipment_tracking_events TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
