-- =============================================================
-- 9.46  Tenant support diagnostics + consented support bundles
-- =============================================================

ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS idx_system_logs_tenant_created
  ON system_logs (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;

-- system_logs is a mixed fleet/tenant table. SET LOCAL ROLE bms_app may read only the
-- active tenant; the base app connection keeps its fleet-wide view.
--
-- Two policies, because permissive policies are OR-ed. bms_app always sets bms.tenant_id
-- (beginTenantTx) so it can only ever satisfy the tenant policy. The base app never sets
-- it, so it satisfies the base policy. Without the second policy, enabling RLS on this
-- pre-existing shared table would deny the log writer and /admin/logs outright on any
-- deployment where the app role does not own the table — i.e. exactly the non-superuser
-- production role this repo still has to move to.
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_logs_bms_app_tenant_read ON system_logs;
CREATE POLICY system_logs_bms_app_tenant_read ON system_logs
  FOR SELECT TO bms_app
  USING (
    tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid
  );
DROP POLICY IF EXISTS system_logs_base_app_full ON system_logs;
CREATE POLICY system_logs_base_app_full ON system_logs
  USING (NULLIF(current_setting('bms.tenant_id', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('bms.tenant_id', true), '') IS NULL);
GRANT SELECT ON system_logs TO bms_app;

CREATE TABLE IF NOT EXISTS bms_support_events (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  client_event_id UUID NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id       TEXT,
  location_id    UUID,
  device_id      UUID,
  session_id     TEXT,
  correlation_id TEXT,
  category       TEXT NOT NULL,
  action         TEXT NOT NULL,
  status         TEXT,
  message        TEXT,
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (length(category) BETWEEN 1 AND 60),
  CHECK (length(action) BETWEEN 1 AND 120),
  CHECK (session_id IS NULL OR length(session_id) <= 120),
  CHECK (correlation_id IS NULL OR length(correlation_id) <= 120)
);

-- Safe recovery if a previous run stopped after CREATE TABLE but before the indexes/grants.
ALTER TABLE bms_support_events ADD COLUMN IF NOT EXISTS client_event_id UUID;
UPDATE bms_support_events SET client_event_id = gen_random_uuid() WHERE client_event_id IS NULL;
ALTER TABLE bms_support_events ALTER COLUMN client_event_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_support_events_tenant_time
  ON bms_support_events (tenant_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_support_events_client_event
  ON bms_support_events (tenant_id, client_event_id);
CREATE INDEX IF NOT EXISTS idx_bms_support_events_device_time
  ON bms_support_events (tenant_id, device_id, occurred_at DESC)
  WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_support_events_session_time
  ON bms_support_events (tenant_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_support_bundles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  requested_by      TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('EXPORTED','SENT','PURGED')),
  range_from        TIMESTAMPTZ NOT NULL,
  range_to          TIMESTAMPTZ NOT NULL,
  description       TEXT,
  file_id           INTEGER REFERENCES files(id) ON DELETE SET NULL,
  support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  event_count       INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  size_bytes        BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  checksum          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
  cleanup_claimed_at TIMESTAMPTZ,
  purged_at         TIMESTAMPTZ,
  CHECK (range_to >= range_from),
  CHECK (range_to - range_from <= interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_bms_support_bundles_tenant_created
  ON bms_support_bundles (tenant_id, created_at DESC);

-- Safe recovery for a partially applied development migration and support for
-- the multi-instance retention worker.
ALTER TABLE bms_support_bundles ADD COLUMN IF NOT EXISTS cleanup_claimed_at TIMESTAMPTZ;
ALTER TABLE bms_support_bundles ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
ALTER TABLE bms_support_bundles DROP CONSTRAINT IF EXISTS bms_support_bundles_status_check;
ALTER TABLE bms_support_bundles ADD CONSTRAINT bms_support_bundles_status_check
  CHECK (status IN ('EXPORTED','SENT','PURGED'));
CREATE INDEX IF NOT EXISTS idx_bms_support_bundles_expired_cleanup
  ON bms_support_bundles (expires_at, id)
  WHERE status = 'SENT' AND file_id IS NOT NULL;

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES bms_tenants(id) ON DELETE SET NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS diagnostic_bundle_id UUID REFERENCES bms_support_bundles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_diagnostic_bundle
  ON support_tickets (diagnostic_bundle_id) WHERE diagnostic_bundle_id IS NOT NULL;

-- Same policy shape as 4.2, and for the same reason: enforce when bms.tenant_id is set
-- (every bms_app transaction sets it, and bms_app is NOBYPASSRLS), stay permissive when it
-- is not so the base app and cron keep working. The strict form -- tenant_id = NULLIF(...)
-- with no COALESCE -- reads as "safer" but under FORCE ROW LEVEL SECURITY it also matches
-- zero rows for the table owner, which would make the fleet-wide retention worker in
-- purgeExpiredSupportBundles() claim nothing, purge nothing, and report success forever.
-- Private bundles that must be deleted at 90 days would simply never be deleted.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_support_events','bms_support_bundles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id)) WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT ON bms_support_events TO bms_app;
GRANT SELECT, INSERT, UPDATE ON bms_support_bundles TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_support_events_id_seq TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'support.logs.view'),
  ('Manager', 'support.logs.export'),
  ('Manager', 'support.logs.send')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
