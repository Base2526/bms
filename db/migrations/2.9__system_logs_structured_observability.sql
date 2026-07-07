-- Extend existing system_logs to support structured client observability.
-- Non-breaking: additive columns + indexes only.

ALTER TABLE system_logs
  ADD COLUMN IF NOT EXISTS created_by INT NULL,
  ADD COLUMN IF NOT EXISTS action TEXT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NULL, -- start|success|error
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS session_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS screen_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS route_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT NULL,
  ADD COLUMN IF NOT EXISTS app_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS duration_ms INT NULL,
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS stack TEXT NULL,
  ADD COLUMN IF NOT EXISTS device_info JSONB NULL;

-- Keep meta default stable (some older installs had NULL default)
ALTER TABLE system_logs
  ALTER COLUMN meta SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_system_logs_created_by_created_at
  ON system_logs (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_logs_action
  ON system_logs (action);

CREATE INDEX IF NOT EXISTS idx_system_logs_status
  ON system_logs (status);

CREATE INDEX IF NOT EXISTS idx_system_logs_correlation_id
  ON system_logs (correlation_id);

CREATE INDEX IF NOT EXISTS idx_system_logs_session_id
  ON system_logs (session_id);

CREATE INDEX IF NOT EXISTS idx_system_logs_platform
  ON system_logs (platform);

CREATE INDEX IF NOT EXISTS idx_system_logs_app_version
  ON system_logs (app_version);

-- Slack alert dedupe (avoid spamming for the same issue)
CREATE TABLE IF NOT EXISTS slack_alert_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_alert_dedupe_last_sent_at
  ON slack_alert_dedupe (last_sent_at DESC);
