-- =============================================================
-- 9.16  Fake-store evaluation ground truth
-- -------------------------------------------------------------
-- Stores a server-only answer key for each generated fake dataset. AI tools
-- never expose these tables; platform-admin QA routes are the only adapter.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_fake_eval_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  label             TEXT NOT NULL DEFAULT 'Fake store evaluation',
  generator_version TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'FAKE_ONLY'
                      CHECK (scope IN ('FAKE_ONLY')),
  data_fingerprint  TEXT NOT NULL,
  source_snapshot   JSONB NOT NULL DEFAULT '{}',
  generated_by      TEXT,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_fake_eval_runs_tenant_generated
  ON bms_fake_eval_runs (tenant_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS bms_fake_eval_cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id         UUID NOT NULL REFERENCES bms_fake_eval_runs(id) ON DELETE CASCADE,
  case_key       TEXT NOT NULL,
  category       TEXT NOT NULL,
  question_th    TEXT NOT NULL,
  question_en    TEXT NOT NULL,
  answer_type    TEXT NOT NULL
                   CHECK (answer_type IN ('NUMBER','BOOLEAN','OBJECT','RANKING','POLICY','ABSTAIN')),
  expected       JSONB NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}',
  tolerance      NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (tolerance >= 0),
  tags           TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, case_key)
);

CREATE INDEX IF NOT EXISTS idx_bms_fake_eval_cases_run
  ON bms_fake_eval_cases (tenant_id, run_id, category, case_key);

CREATE TABLE IF NOT EXISTS bms_fake_eval_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id         UUID NOT NULL REFERENCES bms_fake_eval_runs(id) ON DELETE CASCADE,
  answers        JSONB NOT NULL,
  score          JSONB NOT NULL,
  evaluated_by   TEXT,
  evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_fake_eval_results_run
  ON bms_fake_eval_results (tenant_id, run_id, evaluated_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_fake_eval_runs',
    'bms_fake_eval_cases',
    'bms_fake_eval_results'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($policy$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $policy$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_fake_eval_runs,
  bms_fake_eval_cases,
  bms_fake_eval_results
TO bms_app;

-- The evaluator needs role/safety flags for fake staff counts, not credentials
-- or PII. Keep this column-scoped like the existing users grants.
GRANT SELECT (fake_test, role, is_licensed_pharmacist, pos_only, pos_pin_set_at)
  ON users TO bms_app;
