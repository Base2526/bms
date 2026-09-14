-- =============================================================
-- 9.85  Close remaining realtime business-write coverage gaps
-- -------------------------------------------------------------
-- These tables are authoritative surfaces used by POS/admin but were the
-- remaining writes with no transactional invalidation. The shared trigger
-- emits only routing identifiers and status/change hints. Amounts, customer
-- details, notes, evidence and cart contents stay behind authenticated reads.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_realtime_business_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_old JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
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

  -- A blind-return item intentionally invalidates its parent aggregate. The
  -- item row has neither location nor device and must never invent that scope.
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
  RETURN NEW;
END
$$;

-- Returns and parked/deposit state drive the POS order surface.
DROP TRIGGER IF EXISTS trg_bms_realtime_pos_return ON public.bms_pos_returns;
CREATE TRIGGER trg_bms_realtime_pos_return
AFTER INSERT OR UPDATE ON public.bms_pos_returns
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.return.changed', 'pos_return', 'id', 'return_location_id', 'pos_device_id', 'order_id'
);

DROP TRIGGER IF EXISTS trg_bms_realtime_blind_return ON public.bms_pos_blind_returns;
CREATE TRIGGER trg_bms_realtime_blind_return
AFTER INSERT OR UPDATE ON public.bms_pos_blind_returns
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.return.changed', 'pos_blind_return', 'id', 'location_id', 'device_id', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_blind_return_item ON public.bms_pos_blind_return_items;
CREATE TRIGGER trg_bms_realtime_blind_return_item
AFTER INSERT OR UPDATE ON public.bms_pos_blind_return_items
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.return.changed', 'pos_blind_return', 'blind_return_id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_pos_deposit ON public.bms_pos_deposits;
CREATE TRIGGER trg_bms_realtime_pos_deposit
AFTER INSERT OR UPDATE ON public.bms_pos_deposits
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.deposit.changed', 'pos_deposit', 'id', 'location_id', 'device_id', 'order_id'
);

DROP TRIGGER IF EXISTS trg_bms_realtime_pos_expense ON public.bms_pos_expenses;
CREATE TRIGGER trg_bms_realtime_pos_expense
AFTER INSERT OR UPDATE ON public.bms_pos_expenses
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.expense.changed', 'pos_expense', 'id', '', 'device_id', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_pos_no_sale ON public.bms_pos_no_sales;
CREATE TRIGGER trg_bms_realtime_pos_no_sale
AFTER INSERT OR UPDATE ON public.bms_pos_no_sales
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.no_sale.recorded', 'pos_no_sale', 'id', '', 'device_id', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_parked_sale ON public.bms_pos_parked_sales;
CREATE TRIGGER trg_bms_realtime_parked_sale
AFTER INSERT OR UPDATE ON public.bms_pos_parked_sales
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.parked_sale.changed', 'pos_parked_sale', 'id', 'location_id', 'device_id', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_petty_cash_ledger ON public.bms_pos_petty_cash_ledger;
CREATE TRIGGER trg_bms_realtime_petty_cash_ledger
AFTER INSERT OR UPDATE ON public.bms_pos_petty_cash_ledger
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.petty_cash.changed', 'pos_petty_cash', 'id', 'location_id', 'device_id', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_petty_cash_wallet ON public.bms_pos_petty_cash_wallets;
CREATE TRIGGER trg_bms_realtime_petty_cash_wallet
AFTER INSERT OR UPDATE ON public.bms_pos_petty_cash_wallets
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pos.petty_cash.changed', 'pos_petty_cash', 'location_id', 'location_id', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_pharmacist_authorization ON public.bms_pos_pharmacist_authorizations;
CREATE TRIGGER trg_bms_realtime_pharmacist_authorization
AFTER INSERT OR UPDATE ON public.bms_pos_pharmacist_authorizations
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'pharmacy.authorization.changed', 'pharmacy_authorization', 'id', '', '', 'order_id'
);

-- Store credit, accounts receivable and loyalty are tenant aggregates. Their
-- fan-out carries no customer identifier beyond the opaque aggregate id.
DROP TRIGGER IF EXISTS trg_bms_realtime_store_credit ON public.bms_store_credits;
CREATE TRIGGER trg_bms_realtime_store_credit
AFTER INSERT OR UPDATE ON public.bms_store_credits
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.store_credit.changed', 'store_credit', 'id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_store_credit_ledger ON public.bms_store_credit_ledger;
CREATE TRIGGER trg_bms_realtime_store_credit_ledger
AFTER INSERT OR UPDATE ON public.bms_store_credit_ledger
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.store_credit.changed', 'store_credit', 'credit_id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_ar_account ON public.bms_ar_accounts;
CREATE TRIGGER trg_bms_realtime_ar_account
AFTER INSERT OR UPDATE ON public.bms_ar_accounts
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.ar.changed', 'ar_account', 'id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_ar_invoice ON public.bms_ar_invoices;
CREATE TRIGGER trg_bms_realtime_ar_invoice
AFTER INSERT OR UPDATE ON public.bms_ar_invoices
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.ar.changed', 'ar_invoice', 'id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_ar_receipt ON public.bms_ar_receipts;
CREATE TRIGGER trg_bms_realtime_ar_receipt
AFTER INSERT OR UPDATE ON public.bms_ar_receipts
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.ar.changed', 'ar_receipt', 'id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_ar_ledger ON public.bms_ar_ledger;
CREATE TRIGGER trg_bms_realtime_ar_ledger
AFTER INSERT OR UPDATE ON public.bms_ar_ledger
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'payment.ar.changed', 'ar_account', 'account_id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_tax_document ON public.bms_tax_documents;
CREATE TRIGGER trg_bms_realtime_tax_document
AFTER INSERT OR UPDATE ON public.bms_tax_documents
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'order.tax_document.changed', 'tax_document', 'id', 'location_id', 'device_id', 'order_id'
);

DROP TRIGGER IF EXISTS trg_bms_realtime_loyalty_ledger ON public.bms_loyalty_ledger;
CREATE TRIGGER trg_bms_realtime_loyalty_ledger
AFTER INSERT OR UPDATE ON public.bms_loyalty_ledger
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'order.loyalty.changed', 'loyalty_account', 'customer_id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_purchase_order ON public.bms_purchase_orders;
CREATE TRIGGER trg_bms_realtime_purchase_order
AFTER INSERT OR UPDATE ON public.bms_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'purchase.order.changed', 'purchase_order', 'id', '', '', ''
);

DROP TRIGGER IF EXISTS trg_bms_realtime_inventory_wastage ON public.bms_inventory_wastage;
CREATE TRIGGER trg_bms_realtime_inventory_wastage
AFTER INSERT OR UPDATE ON public.bms_inventory_wastage
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_business_change_trigger(
  'inventory.wastage.recorded', 'inventory_wastage', 'id', 'location_id', '', 'order_id'
);

-- The helper resolves routing only from these authoritative parents. Existing
-- 9.71/9.72 grants cover orders and devices; the blind-return parent is new.
GRANT SELECT (id, tenant_id, location_id, device_id)
  ON public.bms_pos_blind_returns TO bms_realtime_dispatcher;

ALTER FUNCTION public.bms_realtime_business_change_trigger() OWNER TO bms_realtime_dispatcher;

COMMIT;

-- ROLLBACK: drop the 20 trg_bms_realtime_* triggers above, then
-- DROP FUNCTION IF EXISTS public.bms_realtime_business_change_trigger();
