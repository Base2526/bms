-- =============================================================
-- 10.110  Bank reconciliation sidecar
-- -------------------------------------------------------------
-- Statement rows and links are evidence only. Nothing in this migration
-- updates sales, AR, expense, refund, settlement, tax or accounting sources.
-- A suggestion never becomes a match until a reviewer confirms it.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_bank_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bank_code             TEXT NOT NULL CHECK (bank_code ~ '^[A-Z0-9_-]{2,20}$'),
  display_name          TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  account_last4         TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  account_fingerprint   CHAR(64) NOT NULL CHECK (account_fingerprint ~ '^[0-9a-f]{64}$'),
  currency              TEXT NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  default_location_id   UUID,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, account_fingerprint),
  FOREIGN KEY (tenant_id, default_location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE SET NULL (default_location_id)
);

CREATE TABLE IF NOT EXISTS bms_bank_statement_imports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bank_account_id       UUID NOT NULL,
  file_id               INTEGER,
  file_sha256           CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  original_filename     TEXT NOT NULL,
  parser_key            TEXT NOT NULL DEFAULT 'GENERIC_TABULAR',
  parser_version        INTEGER NOT NULL DEFAULT 1 CHECK (parser_version > 0),
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  opening_balance       NUMERIC(18,2),
  closing_balance       NUMERIC(18,2),
  row_count             INTEGER NOT NULL CHECK (row_count > 0 AND row_count <= 50000),
  status                TEXT NOT NULL DEFAULT 'VALIDATED'
                          CHECK (status IN ('VALIDATED','COMMITTED','VOID')),
  idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash          CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  imported_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  committed_at          TIMESTAMPTZ,
  voided_at             TIMESTAMPTZ,
  voided_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, bank_account_id, file_sha256),
  FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES bms_bank_accounts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id)
    REFERENCES files(tenant_id, id) ON DELETE RESTRICT,
  CHECK (period_end >= period_start),
  CHECK ((status = 'VOID') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOID' OR (void_reason IS NOT NULL AND btrim(void_reason) <> ''))
);

-- Keep this named constraint outside CREATE TABLE so the migration also repairs
-- databases that received an earlier draft of this additive migration. A voided
-- import may legitimately have never been committed.
-- Keep the anonymous dollar delimiter here. HeidiSQL's execute-script splitter may
-- split a custom tagged block at the declaration semicolon and send PostgreSQL an
-- unterminated statement.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname
    INTO constraint_name
    FROM pg_constraint c
   WHERE c.conrelid = 'bms_bank_statement_imports'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%status = ''VALIDATED''%committed_at%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE bms_bank_statement_imports DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

ALTER TABLE bms_bank_statement_imports
  DROP CONSTRAINT IF EXISTS bms_bank_statement_imports_commit_shape;
ALTER TABLE bms_bank_statement_imports
  ADD CONSTRAINT bms_bank_statement_imports_commit_shape
  CHECK (
    status = 'VOID'
    OR ((status = 'VALIDATED') = (committed_at IS NULL))
  );

CREATE TABLE IF NOT EXISTS bms_bank_statement_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  import_id             UUID NOT NULL,
  bank_account_id       UUID NOT NULL,
  line_no               INTEGER NOT NULL CHECK (line_no > 0),
  posted_on             DATE NOT NULL,
  transaction_at        TIMESTAMPTZ,
  direction             TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount                NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  balance_after         NUMERIC(18,2),
  reference             TEXT,
  description           TEXT NOT NULL DEFAULT '',
  counterparty_masked   TEXT,
  row_fingerprint       CHAR(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED'
                          CHECK (reconciliation_status IN
                            ('UNMATCHED','SUGGESTED','PARTIAL','MATCHED','IGNORED','STALE')),
  ignored_reason        TEXT,
  ignored_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  ignored_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, import_id, line_no),
  UNIQUE (tenant_id, bank_account_id, row_fingerprint),
  FOREIGN KEY (tenant_id, import_id)
    REFERENCES bms_bank_statement_imports(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES bms_bank_accounts(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((reconciliation_status = 'IGNORED') = (ignored_at IS NOT NULL)),
  CHECK (reconciliation_status <> 'IGNORED'
         OR (ignored_reason IS NOT NULL AND btrim(ignored_reason) <> ''))
);

CREATE TABLE IF NOT EXISTS bms_bank_reconciliation_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bank_entry_id         UUID NOT NULL,
  source_key            TEXT NOT NULL CHECK (source_key ~
                          '^(PAYMENT|AR_RECEIPT|EXPENSE_DOCUMENT|REFUND|DELIVERY_SETTLEMENT|BANK_ENTRY):[0-9a-f-]{36}$'),
  matched_amount        NUMERIC(18,2) NOT NULL CHECK (matched_amount > 0),
  source_fingerprint    CHAR(64) NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  rule_code             TEXT NOT NULL CHECK (btrim(rule_code) <> ''),
  confidence            INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status                TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','VOID')),
  confirmed_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at             TIMESTAMPTZ,
  void_reason           TEXT,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, bank_entry_id)
    REFERENCES bms_bank_statement_entries(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'VOID') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOID' OR (void_reason IS NOT NULL AND btrim(void_reason) <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_bank_reconciliation_active_source
  ON bms_bank_reconciliation_links (tenant_id, bank_entry_id, source_key)
  WHERE status = 'CONFIRMED';

CREATE TABLE IF NOT EXISTS bms_bank_reconciliation_periods (
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bank_account_id       UUID NOT NULL,
  period_month          DATE NOT NULL,
  opening_balance       NUMERIC(18,2),
  closing_balance       NUMERIC(18,2),
  status                TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','READY','CLOSED','REOPENED')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  closed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at             TIMESTAMPTZ,
  reopened_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_at           TIMESTAMPTZ,
  reopen_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, bank_account_id, period_month),
  FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES bms_bank_accounts(tenant_id, id) ON DELETE RESTRICT,
  CHECK (period_month = date_trunc('month', period_month)::date),
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
  CHECK (status <> 'REOPENED'
         OR (reopened_at IS NOT NULL AND reopen_reason IS NOT NULL AND btrim(reopen_reason) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_bms_bank_imports_account_period
  ON bms_bank_statement_imports (tenant_id, bank_account_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_bms_bank_entries_review
  ON bms_bank_statement_entries (tenant_id, bank_account_id, posted_on, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_bms_bank_links_source
  ON bms_bank_reconciliation_links (tenant_id, source_key) WHERE status = 'CONFIRMED';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_bank_accounts',
    'bms_bank_statement_imports',
    'bms_bank_statement_entries',
    'bms_bank_reconciliation_links',
    'bms_bank_reconciliation_periods'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON
  bms_bank_accounts,
  bms_bank_statement_imports,
  bms_bank_statement_entries,
  bms_bank_reconciliation_links,
  bms_bank_reconciliation_periods
TO bms_app;

-- Evidence columns are immutable after INSERT. The application role may only
-- move workflow state forward; it cannot rewrite amounts, dates, fingerprints,
-- account identity or the imported source file behind an audit trail.
REVOKE UPDATE, DELETE ON
  bms_bank_accounts,
  bms_bank_statement_imports,
  bms_bank_statement_entries,
  bms_bank_reconciliation_links,
  bms_bank_reconciliation_periods
FROM bms_app;
GRANT UPDATE (status, updated_at) ON bms_bank_accounts TO bms_app;
GRANT UPDATE (status, committed_at, voided_at, voided_by, void_reason, updated_at)
  ON bms_bank_statement_imports TO bms_app;
GRANT UPDATE (reconciliation_status, ignored_reason, ignored_by, ignored_at)
  ON bms_bank_statement_entries TO bms_app;
GRANT UPDATE (status, voided_by, voided_at, void_reason, version, updated_at)
  ON bms_bank_reconciliation_links TO bms_app;
GRANT UPDATE (opening_balance, closing_balance, status, version, closed_by, closed_at,
              reopened_by, reopened_at, reopen_reason, updated_at)
  ON bms_bank_reconciliation_periods TO bms_app;

SELECT public.create_revision_trigger('bms_bank_accounts');
SELECT public.create_revision_trigger('bms_bank_statement_imports');
SELECT public.create_revision_trigger('bms_bank_statement_entries');
SELECT public.create_revision_trigger('bms_bank_reconciliation_links');
SELECT public.create_revision_trigger('bms_bank_reconciliation_periods');

-- The shared revision helper supports legacy system access when no tenant GUC
-- exists and grants mutable access. Bank evidence history is stricter: deny an
-- unset tenant and keep revision snapshots append-only for the app role.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_bank_accounts_revisions',
    'bms_bank_statement_imports_revisions',
    'bms_bank_statement_entries_revisions',
    'bms_bank_reconciliation_links_revisions',
    'bms_bank_reconciliation_periods_revisions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
    $p$, t || '_tenant_isolation', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM bms_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app', t);
  END LOOP;
END $$;

-- Start narrow: Administrator is a code-level super role and receives every
-- catalog permission. Seed Manager explicitly; other roles need an intentional
-- grant in the role-permission screen.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
CROSS JOIN (VALUES
  ('bank_reconciliation.view'),
  ('bank_reconciliation.import'),
  ('bank_reconciliation.review'),
  ('bank_reconciliation.close')
) AS p(permission)
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_bank_statement_entries IS
  'Immutable imported bank evidence. Reconciliation never posts or changes accounting source records.';
COMMENT ON TABLE bms_bank_reconciliation_links IS
  'Human-confirmed evidence links. source_key is polymorphic and source rows remain authoritative.';

COMMIT;

-- Verify after apply:
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname LIKE 'bms_bank_%';
-- SELECT permission, count(*) FROM bms_role_permissions
--  WHERE permission LIKE 'bank_reconciliation.%' GROUP BY permission;
