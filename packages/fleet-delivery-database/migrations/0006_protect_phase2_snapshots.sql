CREATE OR REPLACE FUNCTION fleet_delivery.protect_merchant_configuration_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active')
     OR OLD.active = false OR NEW.active = true THEN
    RAISE EXCEPTION 'merchant configuration versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS merchant_configuration_version_immutable ON fleet_delivery.merchant_configurations;
CREATE TRIGGER merchant_configuration_version_immutable
  BEFORE UPDATE ON fleet_delivery.merchant_configurations
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_merchant_configuration_version();

CREATE OR REPLACE FUNCTION fleet_delivery.protect_order_context_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'current') IS DISTINCT FROM (to_jsonb(OLD) - 'current')
     OR OLD.current = false OR NEW.current = true THEN
    RAISE EXCEPTION 'order context snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_context_snapshot_immutable ON fleet_delivery.order_context_snapshots;
CREATE TRIGGER order_context_snapshot_immutable
  BEFORE UPDATE ON fleet_delivery.order_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_order_context_snapshot();

CREATE OR REPLACE FUNCTION fleet_delivery.protect_bound_quote()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'BOUND' THEN
    RAISE EXCEPTION 'bound quote is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'BOUND' OR NEW.bound_at IS NULL
     OR (to_jsonb(NEW) - 'status' - 'bound_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'bound_at') THEN
    RAISE EXCEPTION 'quote may only transition from issued to bound' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.protect_delivery_money_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_ref IS DISTINCT FROM OLD.tenant_ref
     OR NEW.branch_ref IS DISTINCT FROM OLD.branch_ref
     OR NEW.bms_order_ref IS DISTINCT FROM OLD.bms_order_ref
     OR NEW.fulfillment_kind IS DISTINCT FROM OLD.fulfillment_kind
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.gross_delivery_fee_satang IS DISTINCT FROM OLD.gross_delivery_fee_satang
     OR NEW.customer_contribution_satang IS DISTINCT FROM OLD.customer_contribution_satang
     OR NEW.merchant_subsidy_satang IS DISTINCT FROM OLD.merchant_subsidy_satang
     OR NEW.explicit_discount_satang IS DISTINCT FROM OLD.explicit_discount_satang
     OR NEW.commission_bps IS DISTINCT FROM OLD.commission_bps
     OR NEW.commission_satang IS DISTINCT FROM OLD.commission_satang
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'delivery financial and authority snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS delivery_money_snapshot_immutable ON fleet_delivery.deliveries;
CREATE TRIGGER delivery_money_snapshot_immutable
  BEFORE UPDATE ON fleet_delivery.deliveries
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_delivery_money_snapshot();
