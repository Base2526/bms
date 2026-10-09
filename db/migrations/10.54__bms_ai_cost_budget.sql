-- Pending/unknown platform expense is held separately from measured cost and
-- customer credits. Never invent a token count or backfill an unknown cost.
ALTER TABLE bms_ai_usage_events
  ADD COLUMN IF NOT EXISTS budget_reserved_usd NUMERIC(16,8) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bms_ai_budget_reserved_nonnegative'
      AND conrelid = 'bms_ai_usage_events'::regclass) THEN
    ALTER TABLE bms_ai_usage_events ADD CONSTRAINT chk_bms_ai_budget_reserved_nonnegative
      CHECK (budget_reserved_usd >= 0);
  END IF;
END $$;

-- The monthly row serializes admission, finalization, and stale cleanup.
CREATE INDEX IF NOT EXISTS idx_bms_ai_usage_shared_budget
  ON bms_ai_usage_events (tenant_id, year_month) WHERE source = 'shared';
