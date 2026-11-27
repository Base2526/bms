-- Preserve the exact reservation order created when staff accepted a kiosk proposal.
-- The check's current_order_id may change on later kitchen rounds or settlement.
-- Legacy accepted proposals remain NULL: historical order identity cannot be inferred safely.
ALTER TABLE bms_restaurant_kiosk_submissions
  ADD COLUMN IF NOT EXISTS accepted_order_id UUID;

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_checks_split_from_branch
  ON bms_restaurant_checks(tenant_id, location_id, split_from_check_id)
  WHERE split_from_check_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'bms_restaurant_kiosk_submissions'::regclass
                   AND conname = 'bms_restaurant_kiosk_accepted_order_location_fk') THEN
    ALTER TABLE bms_restaurant_kiosk_submissions
      ADD CONSTRAINT bms_restaurant_kiosk_accepted_order_location_fk
      FOREIGN KEY (tenant_id, location_id, accepted_order_id)
      REFERENCES bms_orders(tenant_id, location_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'bms_restaurant_kiosk_submissions'::regclass
                   AND conname = 'bms_restaurant_kiosk_accepted_order_status_ck') THEN
    ALTER TABLE bms_restaurant_kiosk_submissions
      ADD CONSTRAINT bms_restaurant_kiosk_accepted_order_status_ck
      CHECK (accepted_order_id IS NULL OR status = 'ACCEPTED');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bms_restaurant_kiosk_accepted_order_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ACCEPTED' AND NEW.accepted_order_id IS NULL THEN
      RAISE EXCEPTION 'accepted kiosk proposal requires its order identity';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'ACCEPTED'
      AND NEW.accepted_order_id IS DISTINCT FROM OLD.accepted_order_id THEN
    RAISE EXCEPTION 'kiosk accepted order identity is immutable';
  END IF;
  IF OLD.status <> 'ACCEPTED' AND NEW.status = 'ACCEPTED'
      AND NEW.accepted_order_id IS NULL THEN
    RAISE EXCEPTION 'accepted kiosk proposal requires its order identity';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bms_restaurant_kiosk_accepted_order_guard_trg
  ON bms_restaurant_kiosk_submissions;
CREATE TRIGGER bms_restaurant_kiosk_accepted_order_guard_trg
  BEFORE INSERT OR UPDATE ON bms_restaurant_kiosk_submissions
  FOR EACH ROW EXECUTE FUNCTION public.bms_restaurant_kiosk_accepted_order_guard();

-- 10.144/10.145 already grant bms_app SELECT/UPDATE and fail-closed RLS on this table.
-- Its existing revision trigger records this added column. No new table or policy is introduced.
COMMENT ON COLUMN bms_restaurant_kiosk_submissions.accepted_order_id IS
  'Order created at kiosk acceptance; immutable provenance, not necessarily the current check order or paid order. NULL for pre-10.148 history.';
