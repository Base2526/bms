-- =============================================================
-- 7.76  BMS Shipping — carrier sync metadata
-- -------------------------------------------------------------
-- Real carrier API integration needs to remember the carrier's own shipment id
-- plus when/how BMS last synchronized tracking data. Keep this additive:
-- manual shipments remain valid and simply leave these fields null or 'manual'.
-- =============================================================

ALTER TABLE bms_shipments
  ADD COLUMN IF NOT EXISTS external_shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS carrier_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_tracking_source TEXT
    CHECK (carrier_tracking_source IN ('manual', 'live', 'mock'));

CREATE INDEX IF NOT EXISTS idx_bms_shipments_external_shipment_id
  ON bms_shipments(tenant_id, external_shipment_id)
  WHERE external_shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_shipments_last_synced
  ON bms_shipments(tenant_id, carrier_last_synced_at DESC)
  WHERE carrier_last_synced_at IS NOT NULL;
