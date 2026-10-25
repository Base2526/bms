-- Release C. Apply after 10.90; no stock, money or realtime triggers.
BEGIN;
ALTER TABLE bms_operation_runs ADD COLUMN IF NOT EXISTS followup_at timestamptz NOT NULL DEFAULT '-infinity';
GRANT UPDATE(followup_at) ON bms_operation_runs TO bms_app;
CREATE INDEX IF NOT EXISTS bms_operation_followup_due ON bms_operation_runs(followup_at,tenant_id) WHERE status NOT IN ('APPROVED','VOID');
CREATE TABLE IF NOT EXISTS bms_operation_policies (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id), location_id uuid NOT NULL,
  supervisor_id text NOT NULL, reminder_minutes integer NOT NULL CHECK(reminder_minutes BETWEEN 0 AND 10080),
  escalation_minutes integer NOT NULL CHECK(escalation_minutes BETWEEN 0 AND 10080),
  enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,location_id), FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  run_id uuid NOT NULL, recipient text NOT NULL, reason text NOT NULL,
  source text NOT NULL CHECK(source IN ('MANUAL','OVERDUE')), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','CLOSED')),
  version integer NOT NULL DEFAULT 1, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by text, acknowledged_at timestamptz, closed_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_operation_escalation_active ON bms_operation_escalations(tenant_id,run_id) WHERE status<>'CLOSED';
CREATE TABLE IF NOT EXISTS bms_operation_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  run_id uuid NOT NULL, recipient text NOT NULL, kind text NOT NULL CHECK(kind IN ('ASSIGNED','DUE_SOON','OVERDUE','REVIEW','ESCALATED')),
  dedup_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE(tenant_id,recipient,dedup_key), FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_notice_inbox ON bms_operation_notices(tenant_id,recipient,created_at DESC);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_operation_policies','bms_operation_escalations','bms_operation_notices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
    EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
  END LOOP;
END $$;
GRANT UPDATE(supervisor_id,reminder_minutes,escalation_minutes,enabled,version,updated_by,updated_at) ON bms_operation_policies TO bms_app;
GRANT UPDATE(recipient,status,version,acknowledged_by,acknowledged_at,closed_at) ON bms_operation_escalations TO bms_app;
GRANT UPDATE(read_at) ON bms_operation_notices TO bms_app;
COMMIT;
-- ROLLBACK: pause the checklist cron, disable policies and remove workspace access before reverting app.
-- Preserve notices/escalations/audit; no destructive rollback or external messages.
