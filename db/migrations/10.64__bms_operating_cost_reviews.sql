-- Management-report classifications only; no cash, stock, tax or source evidence mutation.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_operating_cost_reviews (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key ~ '^(DOCUMENT|POS_EXPENSE|STATEMENT):[0-9a-f-]{36}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  source_fingerprint TEXT NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  decision JSONB NOT NULL CHECK (jsonb_typeof(decision)='object'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_key)
);
ALTER TABLE bms_operating_cost_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_operating_cost_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_operating_cost_reviews_tenant_isolation ON bms_operating_cost_reviews;
CREATE POLICY bms_operating_cost_reviews_tenant_isolation ON bms_operating_cost_reviews
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_operating_cost_reviews TO bms_app;
COMMENT ON TABLE bms_operating_cost_reviews IS
  'Current human management-cost classification. Polymorphic tenant source validated by service; every replacement retains old/new decisions in the same-transaction audit. Not an accounting ledger.';
COMMIT;
-- ROLLBACK: retain classification and audit evidence; revert UI/reader before removing code dependencies.
