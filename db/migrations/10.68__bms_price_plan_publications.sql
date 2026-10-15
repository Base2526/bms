BEGIN;
CREATE TABLE IF NOT EXISTS bms_price_plan_publications (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,request_id)
);
ALTER TABLE bms_price_plan_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_price_plan_publications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_price_plan_publications;
CREATE POLICY tenant_isolation ON bms_price_plan_publications
  USING(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON bms_price_plan_publications TO bms_app;
REVOKE UPDATE,DELETE ON bms_price_plan_publications FROM bms_app;
COMMIT;
-- ROLLBACK: revert application first; retain confirmation and published price history.
