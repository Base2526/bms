BEGIN;
CREATE TABLE IF NOT EXISTS bms_cost_allocations (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_key TEXT NOT NULL CHECK (source_key ~ '^(DOCUMENT|POS_EXPENSE|STATEMENT):[0-9a-f-]{36}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND snapshot @> '{"version":1}'::jsonb),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,month,source_key,version)
);
ALTER TABLE bms_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_cost_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_cost_allocations_tenant_isolation ON bms_cost_allocations;
CREATE POLICY bms_cost_allocations_tenant_isolation ON bms_cost_allocations
  USING (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
REVOKE UPDATE, DELETE ON bms_cost_allocations FROM bms_app;
GRANT SELECT, INSERT ON bms_cost_allocations TO bms_app;
COMMENT ON TABLE bms_cost_allocations IS
  'Append-only monthly management-cost allocation versions; source identity and targets are tenant-validated by service. Snapshot is not a cash, tax, inventory or statutory ledger posting.';
COMMIT;
-- ROLLBACK: revert application first; retain all versions and audit evidence. No historical backfill.
