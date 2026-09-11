-- =============================================================
-- 9.72  Realtime coverage for drawer cash movements and the retail kitchen queue
-- -------------------------------------------------------------
-- `9.71` covered 25 tables but left two business writes that mobile/admin must
-- see with no event at all:
--
--   * `bms_pos_cash_movements` — money entering or leaving the drawer changes
--     the shift's expected cash. Without an event a manager watching the shift
--     sees a stale drawer until the next poll.
--   * `bms_kitchen_tickets` — the NON-restaurant kitchen queue from `9.40`.
--     `listKitchenTickets()` UNIONs this with `bms_restaurant_kitchen_tickets`,
--     so covering only the restaurant half leaves a food_beverage shop with
--     KITCHEN_WORKFLOW on a board that never updates itself.
--
-- Same shape as `9.71`: AFTER triggers that only enqueue into the outbox. They
-- never publish, so a rollback removes the event with the business write.
-- Neither table carries `location_id`, so both derive it server-side — the
-- event rules make these location-scoped and the validator rejects an event
-- that omits its routing scope.
-- =============================================================

BEGIN;

-- ---- drawer cash in/out ---------------------------------------------
-- Location comes from the device that owns the shift; the movement row itself
-- only knows tenant/shift/device.
CREATE OR REPLACE FUNCTION public.bms_realtime_cash_movement_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_location UUID;
BEGIN
  SELECT location_id INTO v_location
    FROM public.bms_pos_devices WHERE tenant_id = NEW.tenant_id AND id = NEW.device_id;
  PERFORM public.bms_emit_realtime_event(
    'pos.cash_movement.recorded', NEW.tenant_id, v_location, NULL,
    'pos_cash_movement', NEW.id::text, NULL, NEW.created_at,
    -- direction only. The amount is drawer detail that belongs behind the
    -- authoritative shift query, not in a fan-out payload.
    jsonb_build_object('change', NEW.direction), NEW.device_id);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_cash_movement ON bms_pos_cash_movements;
CREATE TRIGGER trg_bms_realtime_cash_movement AFTER INSERT ON bms_pos_cash_movements
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_cash_movement_trigger();

-- ---- retail kitchen queue -------------------------------------------
-- Location and device come from the owning order, matching how the restaurant
-- half resolves them from the check.
CREATE OR REPLACE FUNCTION public.bms_realtime_order_kitchen_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_location UUID; v_device UUID;
BEGIN
  SELECT location_id, pos_device_id INTO v_location, v_device
    FROM public.bms_orders WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'kitchen.ticket.created' ELSE 'kitchen.ticket.status_changed' END,
    NEW.tenant_id, v_location, NULL, 'kitchen_ticket', NEW.id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)), v_device);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_order_kitchen ON bms_kitchen_tickets;
CREATE TRIGGER trg_bms_realtime_order_kitchen AFTER INSERT OR UPDATE OF status ON bms_kitchen_tickets
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_order_kitchen_trigger();

-- Ownership must match `9.71`: the emit helper inserts into an outbox with
-- FORCE ROW LEVEL SECURITY, so the definer has to be the BYPASSRLS dispatcher
-- role or every covered write would roll back.
ALTER FUNCTION public.bms_realtime_cash_movement_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_order_kitchen_trigger() OWNER TO bms_realtime_dispatcher;

COMMIT;

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_bms_realtime_cash_movement ON bms_pos_cash_movements;
--   DROP TRIGGER IF EXISTS trg_bms_realtime_order_kitchen ON bms_kitchen_tickets;
--   DROP FUNCTION IF EXISTS public.bms_realtime_cash_movement_trigger();
--   DROP FUNCTION IF EXISTS public.bms_realtime_order_kitchen_trigger();
