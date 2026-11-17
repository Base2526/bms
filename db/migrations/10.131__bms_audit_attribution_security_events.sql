-- 10.131: stable audit attribution and authentication/security events.
-- ROLLBACK: drop bms_security_events, then the new bms_audit_log columns and indexes.
-- Keep old audit rows and the legacy actor column; never rewrite historical identity.

ALTER TABLE bms_audit_log
  ADD COLUMN IF NOT EXISTS actor_kind TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID,
  ADD COLUMN IF NOT EXISTS target_kind TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE INDEX IF NOT EXISTS idx_bms_audit_actor_time
  ON bms_audit_log (tenant_id, actor_user_id, created_at DESC, id DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_audit_time_id
  ON bms_audit_log (tenant_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_audit_event_key
  ON bms_audit_log (tenant_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_audit_conversation
  ON bms_audit_log (tenant_id, (meta->>'conversationId'))
  WHERE meta ? 'conversationId';

-- The application RLS role only needs to append and inspect tenant audit rows.
-- Older migrations granted UPDATE/DELETE; this later migration removes them.
REVOKE UPDATE, DELETE ON bms_audit_log FROM bms_app;

CREATE TABLE IF NOT EXISTS bms_security_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  actor_user_id UUID,
  event TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'ERROR')),
  source TEXT NOT NULL,
  session_ref TEXT,
  reason_code TEXT,
  request_id UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_security_events_actor_time
  ON bms_security_events (tenant_id, actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bms_security_events_time_id
  ON bms_security_events (tenant_id, created_at DESC, id DESC);

ALTER TABLE bms_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_security_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_security_events_tenant ON bms_security_events;
CREATE POLICY bms_security_events_tenant ON bms_security_events TO bms_app
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON bms_security_events TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_security_events_id_seq TO bms_app;

-- Auth is established before a tenant transaction exists. The trusted Web DB role
-- may append an event for an unknown identity or a platform-global administrator.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT ON bms_security_events TO app;
    GRANT USAGE, SELECT ON SEQUENCE bms_security_events_id_seq TO app;
    DROP POLICY IF EXISTS bms_security_events_server ON bms_security_events;
    CREATE POLICY bms_security_events_server ON bms_security_events TO app
      USING (true) WITH CHECK (true);
  END IF;
END $$;
