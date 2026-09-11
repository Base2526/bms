-- =============================================================
-- 9.71  Transactional realtime domain coverage
-- -------------------------------------------------------------
-- These AFTER triggers only enqueue compact invalidations. They never publish
-- network messages and never make the outbox authoritative. Because the row is
-- inserted by the same transaction, rollback removes the event and committed
-- writes remain retryable while Redis/WS is unavailable.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_emit_realtime_event(
  p_event_type TEXT,
  p_tenant_id UUID,
  p_location_id UUID,
  p_user_id UUID,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_aggregate_version BIGINT,
  p_updated_at TIMESTAMPTZ,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_device_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID;
BEGIN
  BEGIN
    v_actor_id := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_actor_id := NULL;
  END;

  INSERT INTO public.bms_realtime_outbox (
    event_id, tenant_id, location_id, user_id, actor_type, actor_id, device_id,
    event_type, schema_version, entity_type, entity_id, aggregate_version,
    entity_updated_at, safe_payload, occurred_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_location_id, p_user_id,
    CASE WHEN v_actor_id IS NULL THEN 'SYSTEM' ELSE 'ADMIN' END,
    v_actor_id, p_device_id, p_event_type, 1, p_entity_type, p_entity_id,
    p_aggregate_version, COALESCE(p_updated_at, clock_timestamp()),
    COALESCE(p_payload, '{}'::jsonb), clock_timestamp()
  );
END
$$;

REVOKE ALL ON FUNCTION public.bms_emit_realtime_event(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, UUID
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.bms_realtime_orders_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bms_emit_realtime_event(
      'order.created', NEW.tenant_id, NEW.location_id, NULL, 'order', NEW.id::text,
      NULL, NEW.updated_at, jsonb_build_object('status', NEW.status), NEW.pos_device_id
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_payload := jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status);
    PERFORM public.bms_emit_realtime_event(
      'order.status_changed', NEW.tenant_id, NEW.location_id, NULL, 'order', NEW.id::text,
      NULL, NEW.updated_at, v_payload, NEW.pos_device_id
    );
    IF NEW.status = 'PAID' THEN
      PERFORM public.bms_emit_realtime_event('order.paid', NEW.tenant_id, NEW.location_id, NULL,
        'order', NEW.id::text, NULL, NEW.updated_at, v_payload, NEW.pos_device_id);
    ELSIF NEW.status = 'CANCELLED' THEN
      PERFORM public.bms_emit_realtime_event('order.cancelled', NEW.tenant_id, NEW.location_id, NULL,
        'order', NEW.id::text, NULL, NEW.updated_at, v_payload, NEW.pos_device_id);
    ELSIF NEW.status IN ('PACKING', 'SHIPPED', 'COMPLETED', 'FULFILLED') THEN
      PERFORM public.bms_emit_realtime_event('order.fulfillment_changed', NEW.tenant_id, NEW.location_id,
        NULL, 'order', NEW.id::text, NULL, NEW.updated_at, v_payload, NEW.pos_device_id);
    END IF;
  END IF;
  IF NEW.pos_device_id IS NOT NULL THEN
    PERFORM public.bms_emit_realtime_event('pos.order.changed', NEW.tenant_id, NEW.location_id, NULL,
      'order', NEW.id::text, NULL, NEW.updated_at,
      jsonb_build_object('status', NEW.status), NEW.pos_device_id);
  END IF;
  PERFORM public.bms_emit_realtime_event('dashboard.invalidated', NEW.tenant_id, NULL, NULL,
    'dashboard', NEW.tenant_id::text, NULL, NEW.updated_at, jsonb_build_object('source', 'order'));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_orders ON bms_orders;
CREATE TRIGGER trg_bms_realtime_orders AFTER INSERT OR UPDATE ON bms_orders
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_orders_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_payments_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_location UUID;
  v_type TEXT;
BEGIN
  SELECT location_id INTO v_location FROM public.bms_orders
   WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN v_type := 'payment.submitted';
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW;
  ELSIF NEW.status = 'CONFIRMED' THEN v_type := 'payment.confirmed';
  ELSIF NEW.status = 'REJECTED' THEN v_type := 'payment.rejected';
  ELSIF NEW.status = 'REFUNDED' THEN v_type := 'payment.refunded';
  ELSE v_type := 'payment.submitted';
  END IF;
  PERFORM public.bms_emit_realtime_event(v_type, NEW.tenant_id, v_location, NULL, 'payment', NEW.id::text,
    NULL, NEW.updated_at, jsonb_strip_nulls(jsonb_build_object(
      'status', NEW.status, 'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)));
  PERFORM public.bms_emit_realtime_event('dashboard.invalidated', NEW.tenant_id, NULL, NULL,
    'dashboard', NEW.tenant_id::text, NULL, NEW.updated_at, jsonb_build_object('source', 'payment'));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_payments ON bms_payments;
CREATE TRIGGER trg_bms_realtime_payments AFTER INSERT OR UPDATE OF status ON bms_payments
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_payments_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_refunds_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_order_id UUID;
  v_location UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT r.order_id, o.location_id INTO v_order_id, v_location
    FROM public.bms_pos_returns r JOIN public.bms_orders o
      ON o.tenant_id = r.tenant_id AND o.id = r.order_id
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.pos_return_id;
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN NEW.status = 'COMPLETED' THEN 'payment.refunded' ELSE 'payment.refund_pending' END,
    NEW.tenant_id, v_location, NULL, 'payment', NEW.payment_id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END))
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_refunds ON bms_pos_refund_allocations;
CREATE TRIGGER trg_bms_realtime_refunds AFTER INSERT OR UPDATE OF status ON bms_pos_refund_allocations
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_refunds_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_line_cancel_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_order_id UUID;
  v_location UUID;
  v_updated TIMESTAMPTZ;
BEGIN
  IF NEW.cancellation_cause IS NULL THEN RETURN NEW; END IF;
  SELECT r.order_id, o.location_id, o.updated_at INTO v_order_id, v_location, v_updated
    FROM public.bms_pos_returns r JOIN public.bms_orders o
      ON o.tenant_id = r.tenant_id AND o.id = r.order_id
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.pos_return_id;
  PERFORM public.bms_emit_realtime_event('order.line_cancelled', NEW.tenant_id, v_location, NULL,
    'order_item', NEW.order_item_id::text, NULL, COALESCE(v_updated, NEW.created_at),
    jsonb_build_object('reasonCode', NEW.cancellation_cause));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_line_cancel ON bms_pos_return_items;
CREATE TRIGGER trg_bms_realtime_line_cancel AFTER INSERT ON bms_pos_return_items
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_line_cancel_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_inventory_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id TEXT;
BEGIN
  v_id := md5(NEW.tenant_id::text || ':' || NEW.location_id::text || ':' || NEW.product_sku || ':' || NEW.size);
  PERFORM public.bms_emit_realtime_event('inventory.changed', NEW.tenant_id, NEW.location_id, NULL,
    'inventory', v_id, NULL, NEW.updated_at, jsonb_build_object('change', TG_OP));
  IF TG_OP = 'INSERT' OR NEW.reserved_stock IS DISTINCT FROM OLD.reserved_stock THEN
    PERFORM public.bms_emit_realtime_event('inventory.reservation_changed', NEW.tenant_id, NEW.location_id,
      NULL, 'inventory', v_id, NULL, NEW.updated_at, jsonb_build_object('change', TG_OP));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_inventory ON bms_inventory;
CREATE TRIGGER trg_bms_realtime_inventory AFTER INSERT OR UPDATE ON bms_inventory
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_inventory_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_transfer_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'IN_TRANSIT' THEN
    PERFORM public.bms_emit_realtime_event('inventory.transfer.sent', NEW.tenant_id, NEW.from_location,
      NULL, 'stock_transfer', NEW.id::text, NULL, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'RECEIVED' THEN
    PERFORM public.bms_emit_realtime_event('inventory.transfer.received', NEW.tenant_id, NEW.to_location,
      NULL, 'stock_transfer', NEW.id::text, NULL, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_transfer ON bms_stock_transfers;
CREATE TRIGGER trg_bms_realtime_transfer AFTER UPDATE OF status ON bms_stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_transfer_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_count_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'APPLIED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.bms_emit_realtime_event('inventory.count.applied', NEW.tenant_id, NEW.location_id,
      NULL, 'stock_count', NEW.id::text, NULL, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_count ON bms_stock_counts;
CREATE TRIGGER trg_bms_realtime_count AFTER UPDATE OF status ON bms_stock_counts
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_count_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_product_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM public.bms_emit_realtime_event('product.availability.changed', NEW.tenant_id, NULL, NULL,
      'product', md5(NEW.tenant_id::text || ':' || NEW.sku), NULL, NEW.updated_at,
      jsonb_build_object('status', CASE WHEN NEW.active THEN 'ACTIVE' ELSE 'INACTIVE' END,
        'previousStatus', CASE WHEN OLD.active THEN 'ACTIVE' ELSE 'INACTIVE' END));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_product ON bms_products;
CREATE TRIGGER trg_bms_realtime_product AFTER UPDATE OF active ON bms_products
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_product_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_menu_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.bms_emit_realtime_event('menu.availability.changed', v_row.tenant_id, v_row.location_id,
    NULL, 'menu_availability', md5(v_row.tenant_id::text || ':' || v_row.location_id::text || ':' || v_row.product_sku),
    NULL, clock_timestamp(), jsonb_build_object('status', CASE WHEN TG_OP = 'DELETE' THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END));
  RETURN v_row;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_menu ON bms_product_menu_unavailability;
CREATE TRIGGER trg_bms_realtime_menu AFTER INSERT OR UPDATE OR DELETE ON bms_product_menu_unavailability
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_menu_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_conversation_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event('inbox.conversation.changed', NEW.tenant_id, NULL, NULL,
    'conversation', NEW.id::text, NULL, NEW.updated_at, jsonb_build_object('status', NEW.status));
  IF TG_OP = 'UPDATE' AND NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id THEN
    PERFORM public.bms_emit_realtime_event('inbox.assignment.changed', NEW.tenant_id, NULL, NULL,
      'conversation', NEW.id::text, NULL, NEW.updated_at, jsonb_build_object('change', 'assignment'));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.bms_emit_realtime_event('inbox.status.changed', NEW.tenant_id, NULL, NULL,
      'conversation', NEW.id::text, NULL, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_conversation ON bms_conversations;
CREATE TRIGGER trg_bms_realtime_conversation AFTER INSERT OR UPDATE ON bms_conversations
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_conversation_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_message_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event('inbox.message.created', NEW.tenant_id, NULL, NULL,
    'message', NEW.id::text, NULL, NEW.created_at, jsonb_build_object('source', NEW.direction));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_message ON bms_messages;
CREATE TRIGGER trg_bms_realtime_message AFTER INSERT ON bms_messages
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_message_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_shipment_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_location UUID;
  v_type TEXT;
BEGIN
  SELECT location_id INTO v_location FROM public.bms_orders
   WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN v_type := 'shipment.created';
  ELSIF NEW.carrier_booking_status = 'failed' AND NEW.carrier_booking_status IS DISTINCT FROM OLD.carrier_booking_status THEN
    v_type := 'shipment.booking_failed';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN v_type := 'shipment.status_changed';
  ELSE RETURN NEW;
  END IF;
  PERFORM public.bms_emit_realtime_event(v_type, NEW.tenant_id, v_location, NULL, 'shipment', NEW.id::text,
    NULL, NEW.updated_at, jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_shipment ON bms_shipments;
CREATE TRIGGER trg_bms_realtime_shipment AFTER INSERT OR UPDATE OF status, carrier_booking_status ON bms_shipments
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_shipment_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_pharmacy_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bms_emit_realtime_event('pharmacy.case.created', NEW.tenant_id, NULL, NULL,
      'pharmacy_case', NEW.id::text, NEW.version, NEW.updated_at, jsonb_build_object('status', NEW.status));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.bms_emit_realtime_event('pharmacy.case.status_changed', NEW.tenant_id, NULL, NULL,
      'pharmacy_case', NEW.id::text, NEW.version, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_pharmacist_id IS DISTINCT FROM OLD.assigned_pharmacist_id THEN
    PERFORM public.bms_emit_realtime_event('pharmacy.case.assigned', NEW.tenant_id, NULL, NULL,
      'pharmacy_case', NEW.id::text, NEW.version, NEW.updated_at, jsonb_build_object('change', 'assignment'));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_pharmacy ON bms_pharmacy_assessments;
CREATE TRIGGER trg_bms_realtime_pharmacy AFTER INSERT OR UPDATE OF status, assigned_pharmacist_id ON bms_pharmacy_assessments
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pharmacy_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_restaurant_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_event TEXT;
  v_version BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'bms_restaurant_checks' THEN
    v_event := CASE WHEN TG_OP = 'INSERT' THEN 'restaurant.check.created' ELSE 'restaurant.check.updated' END;
    v_version := NEW.version;
    PERFORM public.bms_emit_realtime_event(v_event, NEW.tenant_id, NEW.location_id, NULL,
      'restaurant_check', NEW.id::text, v_version, NEW.updated_at, jsonb_build_object('status', NEW.status), NEW.pos_device_id);
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'PAID' THEN
      PERFORM public.bms_emit_realtime_event('restaurant.check.paid', NEW.tenant_id, NEW.location_id,
        NULL, 'restaurant_check', NEW.id::text, v_version, NEW.updated_at,
        jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status), NEW.pos_device_id);
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CANCELLED' THEN
      PERFORM public.bms_emit_realtime_event('restaurant.check.cancelled', NEW.tenant_id, NEW.location_id,
        NULL, 'restaurant_check', NEW.id::text, v_version, NEW.updated_at,
        jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status), NEW.pos_device_id);
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Check events use the generic function above. Other restaurant aggregates need
-- their own joins because branch ownership lives on the parent check.
DROP TRIGGER IF EXISTS trg_bms_realtime_restaurant_check ON bms_restaurant_checks;
CREATE TRIGGER trg_bms_realtime_restaurant_check AFTER INSERT OR UPDATE ON bms_restaurant_checks
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_restaurant_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_restaurant_item_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_location UUID; v_device UUID; v_version BIGINT;
BEGIN
  SELECT location_id, pos_device_id, version INTO v_location, v_device, v_version
    FROM public.bms_restaurant_checks WHERE tenant_id = NEW.tenant_id AND id = NEW.check_id;
  IF TG_OP = 'UPDATE' AND NEW.status = 'SENT' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.bms_emit_realtime_event('restaurant.round.sent', NEW.tenant_id, v_location, NULL,
      'restaurant_check', NEW.check_id::text, v_version, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status), v_device);
  ELSE
    PERFORM public.bms_emit_realtime_event('restaurant.check.updated', NEW.tenant_id, v_location, NULL,
      'restaurant_check', NEW.check_id::text, v_version, NEW.updated_at,
      jsonb_build_object('change', TG_OP), v_device);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_restaurant_item ON bms_restaurant_check_items;
CREATE TRIGGER trg_bms_realtime_restaurant_item AFTER INSERT OR UPDATE ON bms_restaurant_check_items
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_restaurant_item_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_kitchen_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_location UUID; v_device UUID; v_version BIGINT;
BEGIN
  SELECT location_id, pos_device_id, version INTO v_location, v_device, v_version
    FROM public.bms_restaurant_checks WHERE tenant_id = NEW.tenant_id AND id = NEW.check_id;
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'restaurant.ticket.created' ELSE 'restaurant.ticket.status_changed' END,
    NEW.tenant_id, v_location, NULL, 'restaurant_ticket', NEW.id::text, v_version, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)), v_device);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_kitchen ON bms_restaurant_kitchen_tickets;
CREATE TRIGGER trg_bms_realtime_kitchen AFTER INSERT OR UPDATE OF status ON bms_restaurant_kitchen_tickets
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_kitchen_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_request_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bms_emit_realtime_event('restaurant.customer_request.created', NEW.tenant_id, NEW.location_id,
      NULL, 'restaurant_request', NEW.id::text, NEW.version, NEW.updated_at, jsonb_build_object('status', NEW.status));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CONFIRMED' THEN
    PERFORM public.bms_emit_realtime_event('restaurant.customer_request.accepted', NEW.tenant_id, NEW.location_id,
      NULL, 'restaurant_request', NEW.id::text, NEW.version, NEW.updated_at,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_request ON bms_restaurant_order_requests;
CREATE TRIGGER trg_bms_realtime_request AFTER INSERT OR UPDATE OF status ON bms_restaurant_order_requests
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_request_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_qr_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'restaurant.qr_submission.created' ELSE 'restaurant.qr_submission.status_changed' END,
    NEW.tenant_id, NEW.location_id, NULL, 'restaurant_qr_submission', NEW.id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_qr ON bms_restaurant_qr_submissions;
CREATE TRIGGER trg_bms_realtime_qr AFTER INSERT OR UPDATE OF status ON bms_restaurant_qr_submissions
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_qr_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_service_call_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'restaurant.table_call.created' ELSE 'restaurant.table_call.status_changed' END,
    NEW.tenant_id, NEW.location_id, NULL, 'restaurant_table_call', NEW.id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_service_call ON bms_restaurant_service_calls;
CREATE TRIGGER trg_bms_realtime_service_call AFTER INSERT OR UPDATE OF status ON bms_restaurant_service_calls
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_service_call_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_floor_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  PERFORM public.bms_emit_realtime_event('restaurant.floor.changed', v_row.tenant_id, v_row.location_id,
    NULL, 'restaurant_floor', v_row.id::text, NULL, clock_timestamp(), jsonb_build_object('change', TG_OP));
  RETURN v_row;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_area ON bms_restaurant_areas;
CREATE TRIGGER trg_bms_realtime_area AFTER INSERT OR UPDATE OR DELETE ON bms_restaurant_areas
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_floor_trigger();
DROP TRIGGER IF EXISTS trg_bms_realtime_table ON bms_restaurant_tables;
CREATE TRIGGER trg_bms_realtime_table AFTER INSERT OR UPDATE OR DELETE ON bms_restaurant_tables
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_floor_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_waitlist_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event('waitlist.changed', NEW.tenant_id, NEW.location_id, NULL,
    'restaurant_waitlist', NEW.id::text, NULL, NEW.updated_at, jsonb_build_object('status', NEW.status));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_waitlist ON bms_restaurant_waitlist;
CREATE TRIGGER trg_bms_realtime_waitlist AFTER INSERT OR UPDATE ON bms_restaurant_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_waitlist_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.users WHERE id = NEW.user_id;
  IF v_tenant IS NOT NULL THEN
    PERFORM public.bms_emit_realtime_event('notification.created', v_tenant, NULL, NEW.user_id,
      'notification', NEW.id::text, NULL, NEW.created_at, jsonb_build_object('source', NEW.type));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_notification ON notifications;
CREATE TRIGGER trg_bms_realtime_notification AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_notification_trigger();

CREATE OR REPLACE FUNCTION public.bms_realtime_pos_scope_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_TABLE_NAME = 'bms_pos_devices' THEN 'device.session.changed' ELSE 'shift.changed' END,
    NEW.tenant_id, NEW.location_id, NULL,
    CASE WHEN TG_TABLE_NAME = 'bms_pos_devices' THEN 'pos_device' ELSE 'pos_shift' END,
    NEW.id::text, NULL, NEW.updated_at,
    jsonb_build_object('status', CASE WHEN TG_TABLE_NAME = 'bms_pos_devices' THEN
      CASE WHEN NEW.active THEN 'ACTIVE' ELSE 'INACTIVE' END ELSE NEW.status END),
    CASE WHEN TG_TABLE_NAME = 'bms_pos_devices' THEN NEW.id ELSE NEW.device_id END);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bms_realtime_device ON bms_pos_devices;
CREATE TRIGGER trg_bms_realtime_device AFTER INSERT OR UPDATE ON bms_pos_devices
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_scope_trigger();
DROP TRIGGER IF EXISTS trg_bms_realtime_shift ON bms_pos_shifts;
CREATE TRIGGER trg_bms_realtime_shift AFTER INSERT OR UPDATE ON bms_pos_shifts
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_pos_scope_trigger();

-- All trigger functions are owned by the locked, non-login dispatcher role so
-- their trigger-only outbox insert works even for legacy autocommit writers.
ALTER FUNCTION public.bms_emit_realtime_event(TEXT, UUID, UUID, UUID, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, UUID) OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_orders_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_payments_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_refunds_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_line_cancel_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_inventory_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_transfer_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_count_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_product_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_menu_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_conversation_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_message_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_shipment_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_pharmacy_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_restaurant_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_restaurant_item_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_kitchen_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_request_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_qr_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_service_call_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_floor_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_waitlist_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_notification_trigger() OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_realtime_pos_scope_trigger() OWNER TO bms_realtime_dispatcher;

COMMENT ON FUNCTION public.bms_emit_realtime_event(TEXT, UUID, UUID, UUID, TEXT, TEXT, BIGINT, TIMESTAMPTZ, JSONB, UUID) IS
  'Trigger-only compact invalidation enqueue. It performs no network I/O and exposes no business payload.';

CREATE OR REPLACE FUNCTION public.bms_realtime_outbox_metrics()
RETURNS TABLE (
  pending BIGINT,
  processing BIGINT,
  published BIGINT,
  failed BIGINT,
  oldest_unpublished_seconds DOUBLE PRECISION,
  retry_attempts BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'PENDING'),
    count(*) FILTER (WHERE status = 'PROCESSING'),
    count(*) FILTER (WHERE status = 'PUBLISHED'),
    count(*) FILTER (WHERE status = 'FAILED'),
    COALESCE(max(EXTRACT(EPOCH FROM (clock_timestamp() - occurred_at)))
      FILTER (WHERE status IN ('PENDING', 'PROCESSING')), 0)::double precision,
    COALESCE(sum(GREATEST(attempts - 1, 0)), 0)::bigint
  FROM public.bms_realtime_outbox
$$;

ALTER FUNCTION public.bms_realtime_outbox_metrics() OWNER TO bms_realtime_dispatcher;
REVOKE ALL ON FUNCTION public.bms_realtime_outbox_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_realtime_outbox_metrics() TO app;

COMMIT;
