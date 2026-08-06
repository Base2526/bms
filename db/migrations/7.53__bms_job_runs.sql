-- =============================================================
-- 7.53  BMS Job Runs — execution history for cron/batch entrypoints
-- -------------------------------------------------------------
-- Fills the gap /admin/operations-schedule always admitted to (see the
-- "For this mockup, 'last run' is intentionally omitted... no trustworthy
-- run-history source" banner in OperationsScheduleClient.tsx): that page
-- only reads source files to describe what a job *should* do — it never
-- recorded a single real invocation. This table is that missing source.
--
-- Platform-wide, no tenant_id/RLS (same reasoning as bms_ai_provider_health
-- in 7.34) — a cron run is not a tenant's data, it's a platform operational
-- event. `job_name` matches the `key` used by operationsSchedule.ts's
-- DEFINITIONS array (e.g. "release-expired", "channel-health") so the two
-- can be joined in the UI without inventing a second registry.
--
-- One row per invocation, written by lib/bms/jobRuns.ts:
--   startJobRun()  -> INSERT status='running'
--   finishJobRun() -> UPDATE to 'success'/'error' + finished_at + output/error
-- A run that crashes the process before finishJobRun() runs stays 'running'
-- forever — the UI treats any 'running' row older than a safety threshold
-- as effectively failed/stuck rather than pretending it's still in flight.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_job_runs (
  id          BIGSERIAL PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output      JSONB,
  error       TEXT,
  triggered_by TEXT  -- 'cron' (x-cron-secret) vs 'manual' (admin clicked a button), NULL = unknown/legacy
);

CREATE INDEX IF NOT EXISTS idx_bms_job_runs_job_started
  ON bms_job_runs(job_name, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON bms_job_runs TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
