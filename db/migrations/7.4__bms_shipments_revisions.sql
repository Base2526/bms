-- =============================================================
-- 7.4  BMS shipments revision table
-- -------------------------------------------------------------
-- Shipment history belongs with the high-risk business records.
-- =============================================================

SELECT public.create_revision_trigger('bms_shipments');
