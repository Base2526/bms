-- =============================================================
-- 9.86  Emit realtime invalidation when a parked sale is removed
-- -------------------------------------------------------------
-- Resuming or discarding a parked sale deletes its row. Migration 9.85
-- listened only for INSERT/UPDATE, so another register could retain the
-- removed bill until its fallback refresh. The shared helper now reads OLD
-- for DELETE while preserving the same compact, non-sensitive envelope.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_realtime_business_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row JSONB;
  v_old JSONB;
  v_event_type TEXT := TG_ARGV[0];
  v_entity_type TEXT := TG_ARGV[1];
  v_entity_field TEXT := COALESCE(NULLIF(TG_ARGV[2], ''), 'id');
  v_location_field TEXT := NULLIF(TG_ARGV[3], '');
  v_device_field TEXT := NULLIF(TG_ARGV[4], '');
  v_order_field TEXT := NULLIF(TG_ARGV[5], '');
  v_entity_id TEXT;
  v_location UUID;
  v_device UUID;
  v_order UUID;
  v_updated_at TIMESTAMPTZ;
  v_status TEXT;
  v_previous_status TEXT;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;

  v_entity_id := COALESCE(NULLIF(v_row ->> v_entity_field, ''), md5(v_row::text));
  IF v_location_field IS NOT NULL THEN
    v_location := NULLIF(v_row ->> v_location_field, '')::uuid;
  END IF;
  IF v_device_field IS NOT NULL THEN
    v_device := NULLIF(v_row ->> v_device_field, '')::uuid;
  END IF;
  IF v_order_field IS NOT NULL THEN
    v_order := NULLIF(v_row ->> v_order_field, '')::uuid;
  END IF;

  IF TG_TABLE_NAME = 'bms_pos_blind_return_items' THEN
    SELECT location_id, device_id INTO v_location, v_device
      FROM public.bms_pos_blind_returns
     WHERE tenant_id = (v_row ->> 'tenant_id')::uuid
       AND id = (v_row ->> 'blind_return_id')::uuid;
  END IF;

  IF v_order IS NOT NULL AND (v_location IS NULL OR v_device IS NULL) THEN
    SELECT COALESCE(v_location, location_id), COALESCE(v_device, pos_device_id)
      INTO v_location, v_device
      FROM public.bms_orders
     WHERE tenant_id = (v_row ->> 'tenant_id')::uuid AND id = v_order;
  END IF;

  IF v_location IS NULL AND v_device IS NOT NULL THEN
    SELECT location_id INTO v_location
      FROM public.bms_pos_devices
     WHERE tenant_id = (v_row ->> 'tenant_id')::uuid AND id = v_device;
  END IF;

  v_updated_at := COALESCE(
    NULLIF(v_row ->> 'updated_at', '')::timestamptz,
    NULLIF(v_row ->> 'created_at', '')::timestamptz,
    clock_timestamp()
  );
  v_status := COALESCE(NULLIF(v_row ->> 'status', ''), TG_OP);
  v_previous_status := CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(v_old ->> 'status', '') END;

  PERFORM public.bms_emit_realtime_event(
    v_event_type,
    (v_row ->> 'tenant_id')::uuid,
    v_location,
    NULL,
    v_entity_type,
    v_entity_id,
    NULL,
    v_updated_at,
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_status,
      'previousStatus', v_previous_status,
      'change', TG_OP
    )),
    v_device
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_parked_sale ON public.bms_pos_parked_sales;
CREATE TRIGGER trg_bms_realtime_parked_sale
AFTER INSERT OR UPDATE OR DELETE ON public.bms_pos_parked_sales
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.parked_sale.changed', 'pos_parked_sale', 'id', 'location_id', 'device_id', ''
);

ALTER FUNCTION public.bms_realtime_business_change_trigger() OWNER TO bms_realtime_dispatcher;

COMMIT;

-- ROLLBACK (manual, only if this migration must be reversed):
-- 1. Restore public.bms_realtime_business_change_trigger() from migration 9.85.
-- 2. Recreate trg_bms_realtime_parked_sale as AFTER INSERT OR UPDATE only.
