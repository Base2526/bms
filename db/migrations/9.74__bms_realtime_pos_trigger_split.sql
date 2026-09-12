-- =============================================================
-- 9.74  Split realtime POS device and shift triggers
-- -------------------------------------------------------------
-- A trigger function must not access fields that do not exist on every row
-- type it serves. Keep the device and shift row shapes separate so a future
-- PostgreSQL plan/runtime change cannot turn realtime into a business-write
-- failure again.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_realtime_pos_device_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    'device.session.changed',
    NEW.tenant_id,
    NEW.location_id,
    NULL,
    'pos_device',
    NEW.id::text,
    NULL,
    NEW.updated_at,
    jsonb_build_object('status', CASE WHEN NEW.active THEN 'ACTIVE' ELSE 'INACTIVE' END),
    NEW.id
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.bms_realtime_pos_shift_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    'shift.changed',
    NEW.tenant_id,
    NEW.location_id,
    NULL,
    'pos_shift',
    NEW.id::text,
    NULL,
    NEW.updated_at,
    jsonb_build_object('status', NEW.status),
    NEW.device_id
  );
  RETURN NEW;
END
$$;

ALTER FUNCTION public.bms_realtime_pos_device_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_pos_shift_trigger() OWNER TO bms_realtime_dispatcher;

DROP TRIGGER IF EXISTS trg_bms_realtime_device ON public.bms_pos_devices;
CREATE TRIGGER trg_bms_realtime_device
AFTER INSERT OR UPDATE ON public.bms_pos_devices
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_device_trigger();

DROP TRIGGER IF EXISTS trg_bms_realtime_shift ON public.bms_pos_shifts;
CREATE TRIGGER trg_bms_realtime_shift
AFTER INSERT OR UPDATE ON public.bms_pos_shifts
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_shift_trigger();

DROP FUNCTION IF EXISTS public.bms_realtime_pos_scope_trigger();

COMMIT;

-- ROLLBACK (manual, only if this migration must be reversed):
-- Recreate bms_realtime_pos_scope_trigger() from 9.73, reattach both triggers
-- to it, then drop bms_realtime_pos_device_trigger() and
-- bms_realtime_pos_shift_trigger(). Keep 9.73's IF branches intact; restoring
-- the original 9.71 CASE expression makes POS device writes fail.
