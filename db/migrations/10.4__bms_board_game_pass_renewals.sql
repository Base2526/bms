-- =============================================================
-- 10.4  Automatic board-game member-pass renewal
-- -------------------------------------------------------------
-- The platform has no stored-card provider contract. Automatic renewal is
-- therefore deliberately backed by customer-bound store credit: one atomic
-- transaction creates the new entitlement, records payment, and debits the
-- credit ledger. Insufficient balance creates no pass and moves the agreement
-- to PAST_DUE for a bounded retry.
-- =============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_store_credits_tenant_id
  ON bms_store_credits (tenant_id, id);

CREATE TABLE IF NOT EXISTS bms_board_game_pass_renewals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id           UUID NOT NULL REFERENCES bms_customers(id),
  source_pass_id        UUID NOT NULL,
  plan_id               UUID,
  store_credit_id       UUID NOT NULL,
  location_id           UUID,
  plan_code             TEXT NOT NULL,
  plan_name             TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('UNLIMITED','MINUTES')),
  included_minutes      INTEGER,
  price                 NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  duration_days         INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','PAST_DUE','PAUSED','CANCELLED')),
  renew_at              TIMESTAMPTZ NOT NULL,
  next_attempt_at       TIMESTAMPTZ NOT NULL,
  failure_count         INTEGER NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 1000),
  last_attempt_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error            TEXT,
  consented_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  consented_by          UUID REFERENCES users(id),
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID REFERENCES users(id),
  cancel_reason         TEXT,
  version               INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, source_pass_id)
    REFERENCES bms_board_game_member_passes(tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id)
    REFERENCES bms_board_game_pass_plans(tenant_id, id),
  FOREIGN KEY (tenant_id, store_credit_id)
    REFERENCES bms_store_credits(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  CONSTRAINT bms_board_game_pass_renewals_minutes_shape CHECK (
    (kind = 'MINUTES') = (included_minutes IS NOT NULL)
  ),
  CONSTRAINT bms_board_game_pass_renewals_cancel_shape CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_pass_renewals_live
  ON bms_board_game_pass_renewals (tenant_id, customer_id, plan_code, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('ACTIVE','PAST_DUE','PAUSED');
CREATE INDEX IF NOT EXISTS idx_bms_board_game_pass_renewals_due
  ON bms_board_game_pass_renewals (next_attempt_at, tenant_id)
  WHERE status IN ('ACTIVE','PAST_DUE');

ALTER TABLE bms_board_game_member_passes
  ADD COLUMN IF NOT EXISTS renewal_id UUID;
ALTER TABLE bms_board_game_member_passes
  DROP CONSTRAINT IF EXISTS bms_board_game_member_passes_renewal_fk;
ALTER TABLE bms_board_game_member_passes
  ADD CONSTRAINT bms_board_game_member_passes_renewal_fk
  FOREIGN KEY (tenant_id, renewal_id)
  REFERENCES bms_board_game_pass_renewals(tenant_id, id);

ALTER TABLE bms_store_credit_ledger
  ADD COLUMN IF NOT EXISTS board_game_member_pass_id UUID;
ALTER TABLE bms_store_credit_ledger
  DROP CONSTRAINT IF EXISTS bms_store_credit_ledger_member_pass_fk;
ALTER TABLE bms_store_credit_ledger
  ADD CONSTRAINT bms_store_credit_ledger_member_pass_fk
  FOREIGN KEY (tenant_id, board_game_member_pass_id)
  REFERENCES bms_board_game_member_passes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_store_credit_ledger_member_pass
  ON bms_store_credit_ledger (tenant_id, credit_id, board_game_member_pass_id)
  WHERE kind = 'REDEEM' AND board_game_member_pass_id IS NOT NULL;

ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS board_game_member_pass_id UUID;
ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_payable_shape;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_payable_shape CHECK (
    (
      (payable_type = 'ORDER' AND order_id IS NOT NULL
        AND board_game_reservation_id IS NULL AND board_game_member_pass_id IS NULL)
      OR (payable_type = 'BOARD_GAME_RESERVATION' AND order_id IS NULL
        AND board_game_reservation_id IS NOT NULL AND board_game_member_pass_id IS NULL
        AND source_payment_id IS NULL)
      OR (payable_type = 'BOARD_GAME_MEMBER_PASS' AND order_id IS NULL
        AND board_game_reservation_id IS NULL AND board_game_member_pass_id IS NOT NULL
        AND source_payment_id IS NULL)
    )
    AND (
      (source_payment_id IS NULL AND method <> 'RESERVATION_DEPOSIT')
      OR (source_payment_id IS NOT NULL AND payable_type = 'ORDER'
        AND method = 'RESERVATION_DEPOSIT')
    )
  );
ALTER TABLE bms_payments
  DROP CONSTRAINT IF EXISTS bms_payments_board_game_member_pass_fk;
ALTER TABLE bms_payments
  ADD CONSTRAINT bms_payments_board_game_member_pass_fk
  FOREIGN KEY (tenant_id, board_game_member_pass_id)
  REFERENCES bms_board_game_member_passes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_payments_board_game_member_pass
  ON bms_payments (tenant_id, board_game_member_pass_id)
  WHERE payable_type = 'BOARD_GAME_MEMBER_PASS' AND status = 'CONFIRMED';

CREATE TABLE IF NOT EXISTS bms_board_game_pass_renewal_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  renewal_id            UUID NOT NULL,
  scheduled_for         TIMESTAMPTZ NOT NULL,
  attempt_no            INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 1000),
  status                TEXT NOT NULL CHECK (status IN (
                          'SUCCEEDED','INSUFFICIENT_CREDIT','FAILED','SKIPPED'
                        )),
  amount                NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  member_pass_id        UUID,
  payment_id            UUID,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, renewal_id, scheduled_for, attempt_no),
  FOREIGN KEY (tenant_id, renewal_id)
    REFERENCES bms_board_game_pass_renewals(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, member_pass_id)
    REFERENCES bms_board_game_member_passes(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id)
    REFERENCES bms_payments(tenant_id, id)
);

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'bms_board_game_pass_renewals', 'bms_board_game_pass_renewal_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, tbl || '_tenant_isolation', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bms_app', tbl);
  END LOOP;
END $$;

SELECT public.create_revision_trigger('bms_board_game_pass_renewals');

COMMENT ON TABLE bms_board_game_pass_renewals IS
  'Customer-consented automatic member-pass renewal funded by customer-bound store credit.';
COMMENT ON TABLE bms_board_game_pass_renewal_runs IS
  'Immutable renewal attempts. A failed debit never creates an entitlement.';

COMMIT;

