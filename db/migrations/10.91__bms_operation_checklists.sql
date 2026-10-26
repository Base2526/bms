-- Release A+B: versioned staff checklists and food-safety evidence. No stock/money writes.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_operation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  family_id UUID NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  location_id UUID NOT NULL, station_id UUID,
  name TEXT NOT NULL, category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
  separate_reviewer BOOLEAN NOT NULL DEFAULT true,
  items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,family_id,version),
  FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_operation_template_active ON bms_operation_templates(tenant_id,family_id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS bms_operation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL, location_id UUID NOT NULL, station_id UUID,
  snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','IN_PROGRESS','SUBMITTED','APPROVED','REJECTED','VOID')),
  version INTEGER NOT NULL DEFAULT 1, assigned_to TEXT, created_by TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL, started_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ, reviewed_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,template_id) REFERENCES bms_operation_templates(tenant_id,id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_runs_due ON bms_operation_runs(tenant_id,location_id,status,due_at,id);
CREATE TABLE IF NOT EXISTS bms_operation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL, item_key TEXT NOT NULL, revision INTEGER NOT NULL,
  value JSONB NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('PASS','FAIL','NA','RECORDED')),
  note TEXT NOT NULL DEFAULT '', photo_ids JSONB NOT NULL DEFAULT '[]',
  recorded_by TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,run_id,item_key,revision), FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL, item_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','VERIFIED')),
  version INTEGER NOT NULL DEFAULT 1, assigned_to TEXT, due_at TIMESTAMPTZ NOT NULL,
  instruction TEXT NOT NULL, resolution TEXT, resolved_by TEXT, verified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,run_id,item_key),
  FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL, item_key TEXT NOT NULL, file_id INTEGER NOT NULL REFERENCES files(id),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,file_id), FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_events (
  id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id UUID, template_id UUID, action TEXT NOT NULL, actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,template_id) REFERENCES bms_operation_templates(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_events_run ON bms_operation_events(tenant_id,run_id,id DESC);
CREATE TABLE IF NOT EXISTS bms_operation_commands (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE, actor TEXT NOT NULL,
  key TEXT NOT NULL, fingerprint TEXT NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,actor,key)
);
CREATE TABLE IF NOT EXISTS bms_operation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL, assigned_to TEXT, timezone TEXT NOT NULL, local_time TIME NOT NULL,
  weekdays INTEGER[] NOT NULL CHECK(cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
  due_minutes INTEGER NOT NULL CHECK(due_minutes BETWEEN 1 AND 10080),
  next_at TIMESTAMPTZ NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,template_id) REFERENCES bms_operation_templates(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_schedule_due ON bms_operation_schedules(tenant_id,next_at) WHERE active;
CREATE TABLE IF NOT EXISTS bms_operation_occurrences (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, run_id UUID NOT NULL,
  PRIMARY KEY(tenant_id,schedule_id,scheduled_at),
  FOREIGN KEY(tenant_id,schedule_id) REFERENCES bms_operation_schedules(tenant_id,id),
  FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_operation_templates','bms_operation_runs','bms_operation_results',
    'bms_operation_actions','bms_operation_evidence','bms_operation_events','bms_operation_commands',
    'bms_operation_schedules','bms_operation_occurrences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
    EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
  END LOOP;
END $$;
GRANT UPDATE(status) ON bms_operation_templates TO bms_app;
GRANT UPDATE(status,version,assigned_to,due_at,started_at,submitted_at,reviewed_at,reviewed_by) ON bms_operation_runs TO bms_app;
GRANT UPDATE(status,version,assigned_to,due_at,resolution,resolved_by,verified_by,updated_at) ON bms_operation_actions TO bms_app;
GRANT UPDATE(active,version,next_at) ON bms_operation_schedules TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_events_id_seq TO bms_app;
GRANT INSERT(filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id) ON files TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE files_id_seq TO bms_app;
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','operations.checklist.view'),('Manager','operations.checklist.execute'),
 ('Manager','operations.checklist.review'),('Manager','operations.checklist.manage'),
 ('Warehouse','operations.checklist.view'),('Warehouse','operations.checklist.execute')) p(role_name,permission) ON p.role_name=r.name
ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable schedules and remove menu access. Keep immutable results/evidence/events.
-- No trigger, existing POS/stock/money behaviour or automatic safety certification is introduced.
