-- =============================================================
-- 10.2  Board-game reservation completion
-- -------------------------------------------------------------
-- Completes the public reservation contract with branch-local time input, bounded request/payment
-- expiry, decision delivery evidence, and reservation deposits carried by the existing payment
-- ledger.  A deposit is a payment liability until it is applied to a real POS order; it is never a
-- Product SKU, never reserves inventory, and never creates a second board-game billing ledger.
-- =============================================================

BEGIN;

ALTER TABLE bms_board_game_public_locations
  ADD COLUMN IF NOT EXISTS reservation_min_advance_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS reservation_request_ttl_minutes INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS reservation_deposit_policy TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS reservation_deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_deposit_payment_window_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS reservation_deposit_refund_cutoff_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE bms_board_game_public_locations
  DROP CONSTRAINT IF EXISTS bms_board_game_public_locations_reservation_policy_check;
ALTER TABLE bms_board_game_public_locations
  ADD CONSTRAINT bms_board_game_public_locations_reservation_policy_check CHECK (
    reservation_min_advance_minutes BETWEEN 30 AND 43200
    AND reservation_request_ttl_minutes BETWEEN 30 AND 10080
    AND reservation_deposit_policy IN ('NONE','FIXED','PERCENT')
    AND reservation_deposit_amount BETWEEN 0 AND 1000000
    AND reservation_deposit_percent BETWEEN 0 AND 100
    AND reservation_deposit_payment_window_minutes BETWEEN 15 AND 1440
    AND reservation_deposit_refund_cutoff_hours BETWEEN 0 AND 168
    AND (
      (reservation_deposit_policy = 'NONE'
        AND reservation_deposit_amount = 0 AND reservation_deposit_percent = 0)
      OR (reservation_deposit_policy = 'FIXED'
        AND reservation_deposit_amount > 0 AND reservation_deposit_percent = 0)
      OR (reservation_deposit_policy = 'PERCENT'
        AND reservation_deposit_amount = 0 AND reservation_deposit_percent > 0)
    )
  );

ALTER TABLE bms_board_game_waitlist
  ADD COLUMN IF NOT EXISTS customer_locale TEXT NOT NULL DEFAULT 'th',
  ADD COLUMN IF NOT EXISTS request_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_notification_status TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS decision_notification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decision_notification_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_notification_error TEXT,
  ADD COLUMN IF NOT EXISTS deposit_policy_snapshot TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS deposit_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_refund_eligible_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_payment_id UUID;

UPDATE bms_board_game_waitlist
   SET request_expires_at = LEAST(reserved_for, created_at + INTERVAL '24 hours')
 WHERE kind = 'RESERVATION' AND source = 'PUBLIC' AND status = 'REQUESTED'
   AND request_expires_at IS NULL;

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_completion_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_completion_shape CHECK (
    customer_locale IN ('th','en')
    AND decision_notification_status IN ('NONE','PENDING','SENDING','SENT','FAILED')
    AND decision_notification_attempts BETWEEN 0 AND 20
    AND (decision_notification_error IS NULL OR length(decision_notification_error) <= 500)
    AND deposit_policy_snapshot IN ('NONE','FIXED','PERCENT')
    AND deposit_amount BETWEEN 0 AND 1000000
    AND deposit_status IN (
      'NOT_REQUIRED','PENDING','SUBMITTED','PAID','REFUND_PENDING','REFUNDED','FORFEITED',
      'CANCELLED','APPLIED'
    )
    AND (
      (deposit_policy_snapshot = 'NONE' AND deposit_amount = 0
        AND deposit_status = 'NOT_REQUIRED' AND deposit_due_at IS NULL
        AND deposit_refund_eligible_until IS NULL AND deposit_payment_id IS NULL)
      OR
      (deposit_policy_snapshot <> 'NONE' AND deposit_amount > 0)
    )
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_closed_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_closed_shape CHECK (
    (status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'REJECTED', 'EXPIRED')) = (closed_at IS NOT NULL)
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_status_check;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_status_check CHECK (status IN (
    'REQUESTED', 'CONFIRMED', 'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW',
    'REJECTED', 'EXPIRED'
  ));

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_kind_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_kind_shape CHECK (
    (
      kind = 'WALK_IN'
      AND source = 'STAFF'
      AND created_by IS NOT NULL
      AND queue_no IS NOT NULL
      AND reserved_for IS NULL
      AND reserved_duration_minutes IS NULL
      AND reserved_table_id IS NULL
      AND confirmed_at IS NULL
      AND checked_in_at IS NULL
      AND status NOT IN ('REQUESTED', 'CONFIRMED', 'REJECTED', 'EXPIRED')
    )
    OR
    (
      kind = 'RESERVATION'
      AND reserved_for IS NOT NULL
      AND reserved_duration_minutes BETWEEN 30 AND 720
      AND ((queue_no IS NULL) = (checked_in_at IS NULL))
      AND (status NOT IN ('WAITING', 'CALLED') OR queue_no IS NOT NULL)
      AND (
        (status = 'REQUESTED' AND source = 'PUBLIC' AND reserved_table_id IS NULL
          AND confirmed_at IS NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('REJECTED', 'CANCELLED', 'EXPIRED') AND source = 'PUBLIC'
          AND reserved_table_id IS NULL AND confirmed_at IS NULL AND closed_at IS NOT NULL)
        OR
        (status = 'CONFIRMED' AND reserved_table_id IS NOT NULL
          AND confirmed_at IS NOT NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED')
          AND reserved_table_id IS NOT NULL AND confirmed_at IS NOT NULL)
      )
    )
  );

-- Generalize the existing payment ledger. Existing order payments keep exactly the same shape;
-- reservation deposits use the mutually-exclusive reservation target.
ALTER TABLE bms_payments ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS payable_type TEXT NOT NULL DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS board_game_reservation_id UUID,
  ADD COLUMN IF NOT EXISTS source_payment_id UUID,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_refunded_amount_check;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_refunded_amount_check CHECK (
    refunded_amount >= 0 AND refunded_amount <= amount
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_payments_tenant_id
  ON bms_payments (tenant_id, id);

UPDATE bms_payments SET payable_type = 'ORDER' WHERE payable_type IS NULL;

ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_payable_shape;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_payable_shape CHECK (
    (
      (payable_type = 'ORDER' AND order_id IS NOT NULL AND board_game_reservation_id IS NULL)
      OR
      (payable_type = 'BOARD_GAME_RESERVATION' AND order_id IS NULL
        AND board_game_reservation_id IS NOT NULL AND source_payment_id IS NULL)
    )
    AND (
      (source_payment_id IS NULL AND method <> 'RESERVATION_DEPOSIT')
      OR (source_payment_id IS NOT NULL AND payable_type = 'ORDER'
        AND method = 'RESERVATION_DEPOSIT')
    )
  );

ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_source_payment_fk;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_source_payment_fk
  FOREIGN KEY (tenant_id, source_payment_id) REFERENCES bms_payments(tenant_id, id);

ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check CHECK (method IN (
  'BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT',
  'RESERVATION_DEPOSIT'
));

ALTER TABLE bms_pos_refund_allocations DROP CONSTRAINT IF EXISTS bms_pos_refund_allocations_method_check;
ALTER TABLE bms_pos_refund_allocations ADD CONSTRAINT bms_pos_refund_allocations_method_check
  CHECK (method IN (
    'BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT',
    'RESERVATION_DEPOSIT'
  ));

ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_board_game_reservation_fk;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_board_game_reservation_fk
  FOREIGN KEY (tenant_id, board_game_reservation_id)
  REFERENCES bms_board_game_waitlist(tenant_id, id);

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_deposit_payment_fk;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_deposit_payment_fk
  FOREIGN KEY (tenant_id, deposit_payment_id) REFERENCES bms_payments(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_bms_payments_board_game_reservation
  ON bms_payments (tenant_id, board_game_reservation_id, status)
  WHERE board_game_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_payments_active_board_game_reservation
  ON bms_payments (tenant_id, board_game_reservation_id)
  WHERE payable_type = 'BOARD_GAME_RESERVATION'
    AND status IN ('PENDING','CONFIRMED');

CREATE TABLE IF NOT EXISTS bms_board_game_reservation_deposit_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  reservation_id     UUID NOT NULL,
  source_payment_id  UUID NOT NULL,
  billing_group_id   UUID NOT NULL,
  order_id           UUID NOT NULL,
  applied_payment_id UUID NOT NULL,
  amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, billing_group_id),
  UNIQUE (tenant_id, applied_payment_id),
  FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES bms_board_game_waitlist(tenant_id, id),
  FOREIGN KEY (tenant_id, billing_group_id)
    REFERENCES bms_board_game_billing_groups(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES bms_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, source_payment_id)
    REFERENCES bms_payments(tenant_id, id),
  FOREIGN KEY (tenant_id, applied_payment_id)
    REFERENCES bms_payments(tenant_id, id)
);

ALTER TABLE bms_board_game_reservation_deposit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_reservation_deposit_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_reservation_deposit_applications_tenant_isolation
  ON bms_board_game_reservation_deposit_applications;
CREATE POLICY bms_board_game_reservation_deposit_applications_tenant_isolation
  ON bms_board_game_reservation_deposit_applications
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_reservation_deposit_applications TO bms_app;
SELECT public.create_revision_trigger('bms_board_game_reservation_deposit_applications');

CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_request_expiry
  ON bms_board_game_waitlist (request_expires_at)
  WHERE status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_deposit_expiry
  ON bms_board_game_waitlist (deposit_due_at)
  WHERE status = 'CONFIRMED' AND deposit_status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_decision_notification
  ON bms_board_game_waitlist (updated_at)
  WHERE decision_notification_status IN ('PENDING','FAILED');

DROP TRIGGER IF EXISTS trg_bms_realtime_board_game_waitlist ON bms_board_game_waitlist;
CREATE TRIGGER trg_bms_realtime_board_game_waitlist
AFTER INSERT OR UPDATE OF status, deposit_status ON bms_board_game_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_board_game_waitlist_trigger();

COMMENT ON COLUMN bms_payments.payable_type IS
  'Authority for the payment target. ORDER preserves the existing sale path; BOARD_GAME_RESERVATION is a pre-session deposit liability.';
COMMENT ON TABLE bms_board_game_reservation_deposit_applications IS
  'Allocation of confirmed reservation deposits into real POS orders. The applied payment is an internal tender, not a second cash receipt.';

COMMIT;
