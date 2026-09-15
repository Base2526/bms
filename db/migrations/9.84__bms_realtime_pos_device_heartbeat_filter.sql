-- =============================================================
-- 9.84  Keep POS device heartbeats out of realtime invalidation
-- -------------------------------------------------------------
-- authenticatePosDevice() periodically updates last_seen_at. A broad UPDATE
-- trigger turned that bookkeeping write into device.session.changed, causing
-- connected RN clients to verify and refetch their active GraphQL queries even
-- though no device identity, session, or configuration had changed.
-- =============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_bms_realtime_device ON public.bms_pos_devices;
CREATE TRIGGER trg_bms_realtime_device
AFTER INSERT OR UPDATE OF
  tenant_id,
  location_id,
  code,
  name,
  registered_pos_no,
  receipt_prefix,
  token_hash,
  token_issued_at,
  active,
  scanner_mode,
  scanner_prefix_key,
  scanner_suffix_key,
  scanner_max_gap_ms
ON public.bms_pos_devices
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_device_trigger();

COMMIT;

-- ROLLBACK (manual, only if this migration must be reversed):
-- DROP TRIGGER IF EXISTS trg_bms_realtime_device ON public.bms_pos_devices;
-- CREATE TRIGGER trg_bms_realtime_device
-- AFTER INSERT OR UPDATE ON public.bms_pos_devices
-- FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_device_trigger();
