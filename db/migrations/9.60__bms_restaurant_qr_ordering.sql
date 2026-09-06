-- =============================================================
-- 9.60  Restaurant table QR ordering
-- -------------------------------------------------------------
-- A printed QR identifies a table but never authorises a kitchen write.
-- Scanning it creates a short-lived session tied to the table's current OPEN
-- check. Customer submissions remain PENDING until a PIN-authenticated member
-- of staff accepts them into the existing restaurant check + reservation + KDS
-- transaction.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_checks_qr_branch_chain
  ON bms_restaurant_checks (tenant_id, location_id, id);

CREATE TABLE IF NOT EXISTS bms_restaurant_table_qr_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  table_id    UUID NOT NULL,
  public_token TEXT NOT NULL CHECK (length(public_token) BETWEEN 32 AND 128),
  public_token_hash TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  UNIQUE (public_token),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);

-- Upgrade a development database where the first draft stored only the printable token. Public
-- lookup uses this digest so a database error cannot echo the live QR token through SQL params.
ALTER TABLE bms_restaurant_table_qr_tokens
  ADD COLUMN IF NOT EXISTS public_token_hash TEXT;
UPDATE bms_restaurant_table_qr_tokens
   SET public_token_hash = encode(digest(public_token, 'sha256'), 'hex')
 WHERE public_token_hash IS NULL;
ALTER TABLE bms_restaurant_table_qr_tokens
  ALTER COLUMN public_token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_table_qr_token_hash
  ON bms_restaurant_table_qr_tokens (public_token_hash);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_table_qr_token_hash_length_ck'
       AND conrelid = 'bms_restaurant_table_qr_tokens'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_table_qr_tokens
      ADD CONSTRAINT bms_restaurant_table_qr_token_hash_length_ck
      CHECK (length(public_token_hash) = 64) NOT VALID;
  END IF;
END $$;
ALTER TABLE bms_restaurant_table_qr_tokens
  VALIDATE CONSTRAINT bms_restaurant_table_qr_token_hash_length_ck;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_table_qr_active
  ON bms_restaurant_table_qr_tokens (tenant_id, table_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS bms_restaurant_qr_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id        UUID NOT NULL,
  table_id           UUID NOT NULL,
  check_id           UUID NOT NULL,
  qr_token_id        UUID NOT NULL,
  session_token_hash TEXT NOT NULL CHECK (length(session_token_hash) = 64),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, table_id, check_id, id),
  UNIQUE (session_token_hash),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, qr_token_id)
    REFERENCES bms_restaurant_table_qr_tokens(tenant_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_qr_sessions_check
  ON bms_restaurant_qr_sessions (tenant_id, check_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS bms_restaurant_qr_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL,
  table_id        UUID NOT NULL,
  check_id        UUID NOT NULL,
  session_id      UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'
  )),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  reviewed_by     UUID REFERENCES users(id),
  rejection_reason TEXT CHECK (
    rejection_reason IS NULL OR length(btrim(rejection_reason)) BETWEEN 1 AND 300
  ),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, idempotency_key),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND rejection_reason IS NULL)
    OR
    (status IN ('ACCEPTED', 'REJECTED') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR
    (status = 'EXPIRED' AND reviewed_at IS NULL AND reviewed_by IS NULL)
  ),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_qr_submissions_inbox
  ON bms_restaurant_qr_submissions (tenant_id, location_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_qr_submissions_session
  ON bms_restaurant_qr_submissions (tenant_id, session_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS bms_restaurant_qr_submission_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  submission_id          UUID NOT NULL,
  product_sku            TEXT NOT NULL,
  size                   TEXT,
  pack_code              TEXT,
  pack_qty               INTEGER NOT NULL CHECK (pack_qty BETWEEN 1 AND 9999),
  modifier_codes         TEXT[] NOT NULL DEFAULT '{}',
  kitchen_note           TEXT CHECK (kitchen_note IS NULL OR length(kitchen_note) <= 300),
  accepted_check_item_id UUID,
  sort_order             INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, submission_id)
    REFERENCES bms_restaurant_qr_submissions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku),
  FOREIGN KEY (tenant_id, accepted_check_item_id)
    REFERENCES bms_restaurant_check_items(tenant_id, id),
  CHECK (cardinality(modifier_codes) <= 30)
);

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_qr_submission_items_submission
  ON bms_restaurant_qr_submission_items (tenant_id, submission_id, sort_order, id);

-- The service derives every link, but these keys keep maintenance SQL and future callers from
-- pairing a QR/session/submission with another table or branch inside the same tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_qr_sessions_chain
  ON bms_restaurant_qr_sessions (tenant_id, location_id, table_id, check_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_qr_tokens_chain
  ON bms_restaurant_table_qr_tokens (tenant_id, location_id, table_id, id);

-- This block also upgrades a development database where an earlier draft of 9.60 was already run.
-- table_id is deliberately not part of the session -> check FK: it is the scan-time table snapshot,
-- while an OPEN check may later move to another table. Runtime validation compares that snapshot to
-- the check's current table and therefore invalidates the old browser session after a move.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_qr_tokens_table_location_fk'
       AND conrelid = 'bms_restaurant_table_qr_tokens'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_table_qr_tokens
      ADD CONSTRAINT bms_restaurant_qr_tokens_table_location_fk
      FOREIGN KEY (tenant_id, location_id, table_id)
      REFERENCES bms_restaurant_tables(tenant_id, location_id, id) NOT VALID;
  END IF;
  ALTER TABLE bms_restaurant_qr_sessions
    DROP CONSTRAINT IF EXISTS bms_restaurant_qr_sessions_check_chain_fk;
  ALTER TABLE bms_restaurant_qr_sessions
    ADD CONSTRAINT bms_restaurant_qr_sessions_check_chain_fk
    FOREIGN KEY (tenant_id, location_id, check_id)
    REFERENCES bms_restaurant_checks(tenant_id, location_id, id) NOT VALID;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_qr_sessions_token_chain_fk'
       AND conrelid = 'bms_restaurant_qr_sessions'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_qr_sessions
      ADD CONSTRAINT bms_restaurant_qr_sessions_token_chain_fk
      FOREIGN KEY (tenant_id, location_id, table_id, qr_token_id)
      REFERENCES bms_restaurant_table_qr_tokens(tenant_id, location_id, table_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_qr_submissions_session_chain_fk'
       AND conrelid = 'bms_restaurant_qr_submissions'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_qr_submissions
      ADD CONSTRAINT bms_restaurant_qr_submissions_session_chain_fk
      FOREIGN KEY (tenant_id, location_id, table_id, check_id, session_id)
      REFERENCES bms_restaurant_qr_sessions(tenant_id, location_id, table_id, check_id, id) NOT VALID;
  END IF;
END $$;

-- Remove the earlier draft's table-bound parent index after its dependent FK has been replaced.
DROP INDEX IF EXISTS uq_bms_restaurant_checks_qr_chain;

ALTER TABLE bms_restaurant_table_qr_tokens
  VALIDATE CONSTRAINT bms_restaurant_qr_tokens_table_location_fk;
ALTER TABLE bms_restaurant_qr_sessions
  VALIDATE CONSTRAINT bms_restaurant_qr_sessions_check_chain_fk;
ALTER TABLE bms_restaurant_qr_sessions
  VALIDATE CONSTRAINT bms_restaurant_qr_sessions_token_chain_fk;
ALTER TABLE bms_restaurant_qr_submissions
  VALIDATE CONSTRAINT bms_restaurant_qr_submissions_session_chain_fk;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_restaurant_table_qr_tokens',
    'bms_restaurant_qr_sessions',
    'bms_restaurant_qr_submissions',
    'bms_restaurant_qr_submission_items'
  ] LOOP
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

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_restaurant_table_qr_tokens,
  bms_restaurant_qr_sessions,
  bms_restaurant_qr_submissions,
  bms_restaurant_qr_submission_items
  TO bms_app;

SELECT public.create_revision_trigger('bms_restaurant_table_qr_tokens');
SELECT public.create_revision_trigger('bms_restaurant_qr_submissions');

COMMENT ON TABLE bms_restaurant_table_qr_tokens IS
  'Rotatable public table locators. Possession identifies a table but does not authorise a kitchen write.';
COMMENT ON TABLE bms_restaurant_qr_sessions IS
  'Short-lived customer sessions bound to the OPEN restaurant check present when a table QR was scanned.';
COMMENT ON TABLE bms_restaurant_qr_submissions IS
  'Customer-proposed dine-in rounds awaiting PIN-authenticated staff acceptance into the existing restaurant transaction.';

-- Closing a check invalidates every scanner session and removes unreviewed proposals from the
-- operational inbox in the same transaction as the close. No cron or process-local cleanup is
-- allowed to be the authority for whether an old phone may keep ordering.
CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'OPEN' AND NEW.status <> 'OPEN' THEN
    UPDATE bms_restaurant_qr_sessions
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND revoked_at IS NULL;
    UPDATE bms_restaurant_qr_submissions
       SET status = 'EXPIRED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND status = 'PENDING';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bms_expire_restaurant_qr_on_check_close ON bms_restaurant_checks;
CREATE TRIGGER trg_bms_expire_restaurant_qr_on_check_close
AFTER UPDATE OF status ON bms_restaurant_checks
FOR EACH ROW EXECUTE FUNCTION bms_expire_restaurant_qr_on_check_close();
