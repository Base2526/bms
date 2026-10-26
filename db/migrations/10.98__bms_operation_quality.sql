BEGIN;
-- H is an availability restriction, not a physical stock/quarantine/value movement.
CREATE UNIQUE INDEX IF NOT EXISTS bms_inventory_lots_tenant_id ON bms_inventory_lots(tenant_id,id);
CREATE TABLE IF NOT EXISTS bms_operation_quality_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 title text NOT NULL,category text NOT NULL,severity text NOT NULL CHECK(severity IN ('NORMAL','URGENT')),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','INVESTIGATING','REVIEW','CLOSED')),
 version int NOT NULL DEFAULT 1,assigned_to text NOT NULL,due_at timestamptz NOT NULL,run_id uuid,
 facts text NOT NULL,hypothesis text NOT NULL DEFAULT '',observed_cause text NOT NULL DEFAULT '',
 source_run_id uuid,source_inspection_id uuid,source_production_id uuid,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),followup_at timestamptz NOT NULL DEFAULT '-infinity',
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,source_run_id) REFERENCES bms_operation_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,source_inspection_id) REFERENCES bms_operation_material_inspections(tenant_id,id),
 FOREIGN KEY(tenant_id,source_production_id) REFERENCES bms_operation_production(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_lot_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,case_id uuid NOT NULL,lot_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED')),version int NOT NULL DEFAULT 1,
 base_unit text NOT NULL,reason text NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 released_by text,released_at timestamptz,inherited_from uuid,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES bms_operation_quality_cases(tenant_id,id),
 FOREIGN KEY(tenant_id,lot_id) REFERENCES bms_inventory_lots(tenant_id,id),
 FOREIGN KEY(tenant_id,inherited_from) REFERENCES bms_operation_lot_holds(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_lot_hold_active ON bms_operation_lot_holds(tenant_id,lot_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS bms_lot_hold_case ON bms_operation_lot_holds(tenant_id,case_id);
CREATE TABLE IF NOT EXISTS bms_operation_quality_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,case_id uuid NOT NULL,hold_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RELEASE','DISPOSE')),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','REJECTED')),
 qty int NOT NULL CHECK(qty>=0),hold_version int NOT NULL,lot_qty int NOT NULL,run_version int NOT NULL,
 proposed_by text NOT NULL,note text NOT NULL,reviewed_by text,review_note text,movement_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES bms_operation_quality_cases(tenant_id,id),
 FOREIGN KEY(tenant_id,hold_id) REFERENCES bms_operation_lot_holds(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_quality_pending_decision ON bms_operation_quality_decisions(tenant_id,hold_id) WHERE status='PENDING';
ALTER TABLE bms_operation_quality_decisions ADD COLUMN IF NOT EXISTS run_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_quality_decisions'::regclass AND conname='bms_quality_decision_run_fk') THEN
  ALTER TABLE bms_operation_quality_decisions ADD CONSTRAINT bms_quality_decision_run_fk FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS bms_quality_case_followup ON bms_operation_quality_cases(tenant_id,followup_at,id) WHERE status<>'CLOSED';
CREATE INDEX IF NOT EXISTS bms_quality_case_workspace ON bms_operation_quality_cases(tenant_id,location_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS bms_operation_quality_events (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,case_id uuid NOT NULL,action text NOT NULL,actor text NOT NULL,note text NOT NULL,
 evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,case_id) REFERENCES bms_operation_quality_cases(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_quality_events_case ON bms_operation_quality_events(tenant_id,case_id,id DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bms_operation_quality_cases','bms_operation_lot_holds','bms_operation_quality_decisions','bms_operation_quality_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
 END LOOP;
END $$;
GRANT UPDATE(status,version,assigned_to,due_at,run_id,hypothesis,observed_cause,followup_at) ON bms_operation_quality_cases TO bms_app;
GRANT UPDATE(status,version,released_by,released_at) ON bms_operation_lot_holds TO bms_app;
GRANT UPDATE(status,reviewed_by,review_note,movement_id,reviewed_at) ON bms_operation_quality_decisions TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_quality_events_id_seq TO bms_app;
ALTER TABLE bms_operation_team_notices DROP CONSTRAINT IF EXISTS bms_operation_team_notices_entity_kind_check;
ALTER TABLE bms_operation_team_notices ADD CONSTRAINT bms_operation_team_notices_entity_kind_check CHECK(entity_kind IN ('ROSTER','HANDOVER','RUN','QUALITY'));
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r CROSS JOIN (VALUES('operations.quality.view'),('operations.quality.manage'),('operations.quality.hold'),('operations.quality.review')) p(permission) WHERE r.name='Manager' ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: never run an older stock writer while ACTIVE holds exist. Stop affected writes first;
-- retain restrictions, evidence and tables. No destructive down migration or automatic release.
