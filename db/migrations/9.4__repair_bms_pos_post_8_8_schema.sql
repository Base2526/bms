-- =============================================================
-- 9.4 — Repair POS schema from migrations 8.9 through 9.2
-- -------------------------------------------------------------
-- Long-lived deployments that skipped 8.8 also skipped the migrations after
-- it. Repairing only the first missing relation makes checkout fail again at
-- the next one (first bundles, then store-credit ledger, then deposits).
--
-- This migration intentionally repeats the idempotent schema/permission parts
-- of 8.9–9.2 and verifies every application-facing column before committing.
-- Keep it atomic: a register must not run against half a payment schema.
-- =============================================================

BEGIN;

-- ---- 8.9: gift cards / store credit ---------------------------
CREATE TABLE IF NOT EXISTS bms_store_credits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  customer_id   UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','VOID','EXPIRED')),
  expires_at    TIMESTAMPTZ,
  issued_by     UUID REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS bms_store_credit_ledger (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  credit_id     UUID NOT NULL REFERENCES bms_store_credits(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('ISSUE','REDEEM','REFUND','REVERSE','EXPIRE','ADJUST')),
  amount        NUMERIC(12,2) NOT NULL,
  order_id      UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  pos_return_id UUID REFERENCES bms_pos_returns(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_redeem
  ON bms_store_credit_ledger (tenant_id, credit_id, order_id) WHERE kind = 'REDEEM';
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_cancel_reverse
  ON bms_store_credit_ledger (tenant_id, credit_id, order_id)
  WHERE kind = 'REVERSE' AND pos_return_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_return_reverse
  ON bms_store_credit_ledger (tenant_id, credit_id, pos_return_id)
  WHERE pos_return_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_store_credits_code
  ON bms_store_credits (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_bms_store_credits_customer
  ON bms_store_credits (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_store_credit_ledger_credit
  ON bms_store_credit_ledger (tenant_id, credit_id, created_at);

ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT'));

ALTER TABLE bms_pos_refund_allocations DROP CONSTRAINT IF EXISTS bms_pos_refund_allocations_method_check;
ALTER TABLE bms_pos_refund_allocations ADD CONSTRAINT bms_pos_refund_allocations_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT'));

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_store_credits', 'bms_store_credit_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_store_credits, bms_store_credit_ledger TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','storecredit.issue'),
  ('Manager','storecredit.redeem'),
  ('Manager','storecredit.adjust'),
  ('Sales','storecredit.redeem'),
  ('Cashier','storecredit.redeem')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- 9.0: deposits / outstanding balances --------------------
CREATE TABLE IF NOT EXISTS bms_pos_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES bms_locations(id),
  device_id       UUID REFERENCES bms_pos_devices(id) ON DELETE SET NULL,
  shift_id        UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL,
  customer_id     UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  customer_note   TEXT,
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  deposit_paid    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_paid >= 0),
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','COMPLETED','CANCELLED','FORFEITED')),
  due_at          TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_id),
  CHECK (deposit_paid <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_bms_deposits_open
  ON bms_pos_deposits (tenant_id, status, due_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_bms_deposits_customer
  ON bms_pos_deposits (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE bms_pos_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_deposits_tenant_isolation ON bms_pos_deposits;
CREATE POLICY bms_pos_deposits_tenant_isolation ON bms_pos_deposits
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_deposits TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.deposit.take'),
  ('Manager','pos.deposit.cancel'),
  ('Sales','pos.deposit.take'),
  ('Cashier','pos.deposit.take')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- 9.1: location management permission ---------------------
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'location.manage'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- 9.2: retry-safe deposit payments ------------------------
ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_payments_idempotency
  ON bms_payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN bms_payments.idempotency_key IS
  'Stable client key for retry-safe payment writes; currently required by POS deposit take/add (9.2; repaired by 9.4)';

-- Fail the migration instead of committing a deceptively partial repair.
DO $$
DECLARE
  missing TEXT;
BEGIN
  WITH required(table_name, column_name) AS (
    VALUES
      ('bms_store_credits','id'), ('bms_store_credits','tenant_id'),
      ('bms_store_credits','code'), ('bms_store_credits','customer_id'),
      ('bms_store_credits','balance'), ('bms_store_credits','status'),
      ('bms_store_credits','expires_at'), ('bms_store_credits','issued_by'),
      ('bms_store_credits','note'), ('bms_store_credits','created_at'),
      ('bms_store_credits','updated_at'),
      ('bms_store_credit_ledger','id'), ('bms_store_credit_ledger','tenant_id'),
      ('bms_store_credit_ledger','credit_id'), ('bms_store_credit_ledger','kind'),
      ('bms_store_credit_ledger','amount'), ('bms_store_credit_ledger','order_id'),
      ('bms_store_credit_ledger','pos_return_id'), ('bms_store_credit_ledger','actor_user_id'),
      ('bms_store_credit_ledger','note'), ('bms_store_credit_ledger','created_at'),
      ('bms_pos_deposits','id'), ('bms_pos_deposits','tenant_id'),
      ('bms_pos_deposits','order_id'), ('bms_pos_deposits','location_id'),
      ('bms_pos_deposits','device_id'), ('bms_pos_deposits','shift_id'),
      ('bms_pos_deposits','customer_id'), ('bms_pos_deposits','customer_note'),
      ('bms_pos_deposits','total_amount'), ('bms_pos_deposits','deposit_paid'),
      ('bms_pos_deposits','status'), ('bms_pos_deposits','due_at'),
      ('bms_pos_deposits','created_by'), ('bms_pos_deposits','completed_at'),
      ('bms_pos_deposits','cancelled_at'), ('bms_pos_deposits','cancelled_by'),
      ('bms_pos_deposits','cancel_reason'), ('bms_pos_deposits','created_at'),
      ('bms_pos_deposits','updated_at'),
      ('bms_payments','idempotency_key')
  )
  SELECT string_agg(r.table_name || '.' || r.column_name, ', ' ORDER BY r.table_name, r.column_name)
    INTO missing
    FROM required r
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = r.table_name
     AND c.column_name = r.column_name
   WHERE c.column_name IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'POS schema repair incomplete; missing: %', missing;
  END IF;
END $$;

COMMIT;
