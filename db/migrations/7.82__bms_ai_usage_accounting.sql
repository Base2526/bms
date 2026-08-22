-- Keep customer billing, provider activity, and metered provider cost as
-- separate dimensions. Legacy columns remain populated during the rollout.
ALTER TABLE bms_ai_usage_events
  ALTER COLUMN estimated_cost TYPE NUMERIC(16,8),
  ADD COLUMN IF NOT EXISTS billable_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpriced_provider_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_usd NUMERIC(16,8);

ALTER TABLE bms_ai_usage_monthly
  ALTER COLUMN estimated_cost TYPE NUMERIC(16,8);

ALTER TABLE bms_ai_usage_events
  ALTER COLUMN actual_cost_usd DROP NOT NULL,
  ALTER COLUMN actual_cost_usd DROP DEFAULT;

WITH legacy AS (
  SELECT id,
         credits_used AS billable_credits,
         CASE
         WHEN COALESCE(meta->>'provider_calls', '') ~ '^[0-9]+$'
           THEN (meta->>'provider_calls')::integer
         WHEN error_message = 'max_rounds_exceeded'
           THEN 5
         WHEN status IN ('blocked', 'fallback') OR source = 'none'
           THEN 0
         WHEN completed_at IS NOT NULL AND source IN ('shared', 'byok')
           THEN 1
         ELSE 0
         END AS provider_calls,
         CASE
         -- The old NUMERIC(12,4) column rounded small valid costs to zero.
         -- Preserve positive known values, but never turn precision loss into a
         -- falsely authoritative $0 historical cost.
         WHEN estimated_cost > 0
           THEN estimated_cost
         WHEN status IN ('blocked', 'fallback') OR source = 'none'
           THEN 0
         ELSE NULL
         END AS actual_cost_usd
    FROM bms_ai_usage_events
   WHERE COALESCE(meta->>'usage_accounting_version', '') <> '2'
)
UPDATE bms_ai_usage_events e
   SET billable_credits = legacy.billable_credits,
       provider_calls = legacy.provider_calls,
       unpriced_provider_calls = CASE
         WHEN legacy.actual_cost_usd IS NULL THEN legacy.provider_calls
         ELSE 0
       END,
       actual_cost_usd = legacy.actual_cost_usd,
       meta = jsonb_set(COALESCE(e.meta, '{}'::jsonb), '{usage_accounting_version}', '2'::jsonb, true)
  FROM legacy
 WHERE e.id = legacy.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_bms_ai_usage_events_billable_credits_nonnegative'
       AND conrelid = 'bms_ai_usage_events'::regclass
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_billable_credits_nonnegative
      CHECK (billable_credits >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_bms_ai_usage_events_provider_calls_nonnegative'
       AND conrelid = 'bms_ai_usage_events'::regclass
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_provider_calls_nonnegative
      CHECK (provider_calls >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_bms_ai_usage_events_actual_cost_usd_nonnegative'
       AND conrelid = 'bms_ai_usage_events'::regclass
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_actual_cost_usd_nonnegative
      CHECK (actual_cost_usd >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_bms_ai_usage_events_unpriced_calls_valid'
       AND conrelid = 'bms_ai_usage_events'::regclass
  ) THEN
    ALTER TABLE bms_ai_usage_events
      ADD CONSTRAINT chk_bms_ai_usage_events_unpriced_calls_valid
      CHECK (unpriced_provider_calls >= 0 AND unpriced_provider_calls <= provider_calls);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_ai_usage_events_created_at
  ON bms_ai_usage_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_ai_usage_events_stale_started
  ON bms_ai_usage_events(tenant_id, year_month, created_at)
  WHERE status = 'started' AND completed_at IS NULL;
