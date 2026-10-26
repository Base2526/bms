BEGIN;
CREATE TABLE IF NOT EXISTS bms_operation_standards (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES bms_tenants(id), location_id uuid NOT NULL,
 family_id uuid NOT NULL, version int NOT NULL CHECK(version>0), duty_key text NOT NULL,
 title text NOT NULL, body text NOT NULL, source jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
 ack_basis_id uuid NOT NULL, training_basis_id uuid NOT NULL, training_required boolean NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,family_id,version),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,ack_basis_id) REFERENCES bms_operation_standards(tenant_id,id),
 FOREIGN KEY(tenant_id,training_basis_id) REFERENCES bms_operation_standards(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_operation_standard_active ON bms_operation_standards(tenant_id,family_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS bms_operation_standard_duty ON bms_operation_standards(tenant_id,location_id,duty_key,status);
CREATE TABLE IF NOT EXISTS bms_operation_learning (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,standard_id uuid NOT NULL,basis_id uuid NOT NULL,
 staff_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('ACK','PASS','PRACTICE')),
 evidence text NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,standard_id) REFERENCES bms_operation_standards(tenant_id,id),
 FOREIGN KEY(tenant_id,basis_id) REFERENCES bms_operation_standards(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_operation_learning_ack ON bms_operation_learning(tenant_id,basis_id,staff_id) WHERE kind='ACK';
CREATE INDEX IF NOT EXISTS bms_operation_learning_staff ON bms_operation_learning(tenant_id,staff_id,basis_id,id DESC);
CREATE TABLE IF NOT EXISTS bms_operation_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 title text NOT NULL,category text NOT NULL,severity text NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 owner_id text NOT NULL,hypothesis text NOT NULL DEFAULT '',cause text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),version int NOT NULL DEFAULT 1,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reopened_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_issues_branch ON bms_operation_issues(tenant_id,location_id,status,created_at,id);
CREATE TABLE IF NOT EXISTS bms_operation_issue_sources (
 tenant_id uuid NOT NULL,issue_id uuid NOT NULL,action_id uuid NOT NULL,linked_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,issue_id,action_id),UNIQUE(tenant_id,action_id),
 FOREIGN KEY(tenant_id,issue_id) REFERENCES bms_operation_issues(tenant_id,id),
 FOREIGN KEY(tenant_id,action_id) REFERENCES bms_operation_actions(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_weekly_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 week_from date NOT NULL,version int NOT NULL,fingerprint text NOT NULL,snapshot jsonb NOT NULL,note text NOT NULL,
 reviewed_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,location_id,week_from,version),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_improvements (
 tenant_id uuid NOT NULL,run_id uuid NOT NULL,issue_id uuid NOT NULL,weekly_review_id uuid,
 target text NOT NULL,baseline jsonb NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,run_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,issue_id) REFERENCES bms_operation_issues(tenant_id,id),
 FOREIGN KEY(tenant_id,weekly_review_id) REFERENCES bms_operation_weekly_reviews(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_improvement_events (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 entity_id uuid NOT NULL,action text NOT NULL,actor text NOT NULL,note text NOT NULL,details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_operation_improvement_history ON bms_operation_improvement_events(tenant_id,entity_id,id DESC);
-- Historical waste has no reliable movement identity: retain NULL, never reconstruct by amount/date/note.
ALTER TABLE bms_operation_production_waste ADD COLUMN IF NOT EXISTS movement_id bigint;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bms_operation_standards','bms_operation_learning','bms_operation_issues','bms_operation_issue_sources','bms_operation_weekly_reviews','bms_operation_improvements','bms_operation_improvement_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
 END LOOP;
END $$;
GRANT UPDATE(status) ON bms_operation_standards TO bms_app;
GRANT UPDATE(title,category,severity,owner_id,hypothesis,cause,status,version,reopened_at) ON bms_operation_issues TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_learning_id_seq,bms_operation_improvement_events_id_seq TO bms_app;
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','operations.standard.manage'),('Manager','operations.standard.assess'),('Manager','operations.improvement.manage'))p(role_name,permission) ON p.role_name=r.name ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable F commands before app rollback. Preserve all evidence and movement links.
-- No new stock/financial postings, external messages or realtime triggers.
