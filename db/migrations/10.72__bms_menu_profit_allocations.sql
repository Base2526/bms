BEGIN;
CREATE TABLE IF NOT EXISTS bms_menu_profit_allocations (
 tenant_id uuid NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
 month text NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 scope text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 snapshot jsonb NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,month,scope,version), UNIQUE(tenant_id,request_id)
);
ALTER TABLE bms_menu_profit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_menu_profit_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_menu_profit_allocations;
CREATE POLICY tenant_isolation ON bms_menu_profit_allocations USING(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON bms_menu_profit_allocations TO bms_app;
REVOKE UPDATE,DELETE ON bms_menu_profit_allocations FROM bms_app;
COMMIT;
-- ROLLBACK: revert application; retain append-only confirmed allocation evidence.
