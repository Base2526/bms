-- 10.104 — Meta Messenger tenant binding and durable inbound processing.
--
-- Apply this additive migration before deploying the application that reads the new columns.
-- Existing Meta channels remain stored, but the application will require the
-- operator to add a Page ID and a distinct webhook verify token before accepting traffic.

ALTER TABLE bms_tenant_channels
  ADD COLUMN IF NOT EXISTS webhook_verify_token TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT;

COMMENT ON COLUMN bms_tenant_channels.webhook_verify_token IS
  'Encrypted provider webhook handshake token; deliberately distinct from channel_secret/App Secret.';
COMMENT ON COLUMN bms_tenant_channels.external_account_id IS
  'Provider-owned account identifier bound to this tenant (Facebook Page ID for Messenger).';

CREATE TABLE IF NOT EXISTS bms_channel_inbound_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL CHECK (channel IN ('facebook','instagram')),
  external_event_id  TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  customer_ref       TEXT NOT NULL,
  message_text       TEXT NOT NULL DEFAULT '',
  attachments        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','DEAD')),
  attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until        TIMESTAMPTZ,
  effects_started_at TIMESTAMPTZ,
  last_error_code    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  UNIQUE (tenant_id, channel, external_event_id)
);

CREATE INDEX IF NOT EXISTS bms_channel_inbound_jobs_due
  ON bms_channel_inbound_jobs(available_at, created_at)
  WHERE status IN ('PENDING','FAILED','PROCESSING');

ALTER TABLE bms_channel_inbound_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_channel_inbound_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_channel_inbound_jobs_tenant_isolation ON bms_channel_inbound_jobs;
CREATE POLICY bms_channel_inbound_jobs_tenant_isolation ON bms_channel_inbound_jobs
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_channel_inbound_jobs TO bms_app;

-- ROLLBACK (only after deploying an application that no longer reads these fields):
-- DROP TABLE bms_channel_inbound_jobs;
-- ALTER TABLE bms_tenant_channels DROP COLUMN webhook_verify_token, DROP COLUMN external_account_id;
