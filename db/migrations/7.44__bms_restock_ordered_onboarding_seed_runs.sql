-- =============================================================
-- 7.44  Paid restock attribution + resumable onboarding sample seed
-- =============================================================

ALTER TABLE bms_restock_subscriptions
  ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ;

ALTER TABLE bms_restock_subscriptions
  DROP CONSTRAINT IF EXISTS bms_restock_subscriptions_status_check;

ALTER TABLE bms_restock_subscriptions
  ADD CONSTRAINT bms_restock_subscriptions_status_check
  CHECK (status IN ('ACTIVE','READY_TO_NOTIFY','NOTIFIED','ORDERED','PURCHASED','CANCELLED','EXPIRED'));

CREATE TABLE IF NOT EXISTS bms_onboarding_seed_runs (
  tenant_id       UUID PRIMARY KEY REFERENCES bms_tenants(id) ON DELETE CASCADE,
  archetype       TEXT,
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','FAILED','COMPLETED')),
  last_error      TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bms_onboarding_seed_runs_archetype_check CHECK (
    archetype IS NULL OR archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'other'
    )
  )
);

ALTER TABLE bms_onboarding_seed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_onboarding_seed_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_onboarding_seed_runs_tenant_isolation ON bms_onboarding_seed_runs;
CREATE POLICY bms_onboarding_seed_runs_tenant_isolation ON bms_onboarding_seed_runs
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_onboarding_seed_runs TO bms_app;
