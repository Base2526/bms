-- =============================================================
-- 9.73  Realtime POS/device trigger field-scope fix
-- -------------------------------------------------------------
-- 9.71 used one CASE expression for bms_pos_devices and bms_pos_shifts.
-- PostgreSQL still resolves NEW.status in that expression when the trigger fires
-- on bms_pos_devices, whose row has no status column, rolling back device setup
-- and every POS test/workflow that creates a register.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_realtime_pos_scope_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'bms_pos_devices' THEN
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
  ELSE
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
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION public.bms_realtime_pos_scope_trigger() OWNER TO bms_realtime_dispatcher;

COMMIT;
