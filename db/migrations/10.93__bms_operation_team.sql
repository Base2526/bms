BEGIN;
-- Team duties are NOT POS drawer shifts or payroll attendance.
CREATE TABLE IF NOT EXISTS bms_operation_rosters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 duty_key text NOT NULL,duty_name text NOT NULL,assigned_to text,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','CANCELLED')),version int NOT NULL DEFAULT 1,
 accepted_at timestamptz,ended_at timestamptz,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_roster_time ON bms_operation_rosters(tenant_id,location_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS bms_operation_handovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,roster_id uuid NOT NULL,
 sender text NOT NULL,recipient text,items jsonb NOT NULL DEFAULT '[]',note text NOT NULL DEFAULT '',due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','RECEIVED','CANCELLED')),version int NOT NULL DEFAULT 1,
 submitted_at timestamptz,received_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),followup_at timestamptz NOT NULL DEFAULT '-infinity',
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,roster_id) REFERENCES bms_operation_rosters(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_operation_handover_active ON bms_operation_handovers(tenant_id,roster_id) WHERE status<>'CANCELLED';
CREATE INDEX IF NOT EXISTS bms_operation_handover_followup ON bms_operation_handovers(tenant_id,followup_at,id) WHERE status='SUBMITTED';
CREATE TABLE IF NOT EXISTS bms_operation_team_events (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 entity_id uuid NOT NULL,action text NOT NULL,actor text NOT NULL,note text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_team_events_entity ON bms_operation_team_events(tenant_id,entity_id,id);
CREATE TABLE IF NOT EXISTS bms_operation_team_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 recipient text NOT NULL,entity_id uuid NOT NULL,entity_kind text NOT NULL CHECK(entity_kind IN ('ROSTER','HANDOVER','RUN')),
 kind text NOT NULL,dedup_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 UNIQUE(tenant_id,recipient,dedup_key),FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_team_notices_user ON bms_operation_team_notices(tenant_id,recipient,created_at DESC);
CREATE TABLE IF NOT EXISTS bms_operation_daily_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 business_date date NOT NULL,version int NOT NULL,fingerprint text NOT NULL,snapshot jsonb NOT NULL,note text NOT NULL,
 reviewed_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,location_id,business_date,version),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
ALTER TABLE bms_operation_schedules ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'FIXED' CHECK(assignment_mode IN ('FIXED','DUTY'));
ALTER TABLE bms_operation_schedules ADD COLUMN IF NOT EXISTS duty_key text;
ALTER TABLE bms_operation_runs ADD COLUMN IF NOT EXISTS assignment_evidence jsonb NOT NULL DEFAULT '{}';
ALTER TABLE bms_operation_policies ADD COLUMN IF NOT EXISTS use_duty_supervisor boolean NOT NULL DEFAULT false;
ALTER TABLE bms_operation_policies ADD COLUMN IF NOT EXISTS supervisor_duty_key text;
GRANT UPDATE(use_duty_supervisor,supervisor_duty_key) ON bms_operation_policies TO bms_app;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bms_operation_rosters','bms_operation_handovers','bms_operation_team_events','bms_operation_team_notices','bms_operation_daily_reviews'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t); EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
 END LOOP;
END $$;
GRANT UPDATE(duty_key,duty_name,assigned_to,starts_at,ends_at,status,version,accepted_at,ended_at) ON bms_operation_rosters TO bms_app;
GRANT UPDATE(recipient,items,note,due_at,status,version,submitted_at,received_at,followup_at) ON bms_operation_handovers TO bms_app;
GRANT UPDATE(read_at) ON bms_operation_team_notices TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_team_events_id_seq TO bms_app;
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','operations.roster.manage'),('Manager','operations.roster.accept'),('Manager','operations.handover.manage'),('Manager','operations.handover.receive'),('Manager','operations.summary.review'),('Warehouse','operations.roster.accept'),('Warehouse','operations.handover.receive'))p(role_name,permission) ON p.role_name=r.name ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable team access and pause the operations cron before reverting the app.
-- Preserve team/assignment/handover/review evidence; no POS, money, stock or realtime triggers.
