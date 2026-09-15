-- =============================================================
-- 9.88  Retry-safe inventory operation results
-- -------------------------------------------------------------
-- Native POS clients can lose an HTTPS response after a stock write commits.
-- Store the request fingerprint and exact result in the same transaction as
-- the transfer/count write so replay never moves stock twice or reports a
-- misleading wrong-state error after the first request succeeded.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_inventory_operation_idempotency (
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash    TEXT NOT NULL CHECK (length(request_hash) = 64),
  result          JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, action, idempotency_key)
);

ALTER TABLE bms_inventory_operation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_inventory_operation_idempotency FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bms_inventory_operation_idempotency_tenant_isolation
  ON bms_inventory_operation_idempotency;
CREATE POLICY bms_inventory_operation_idempotency_tenant_isolation
  ON bms_inventory_operation_idempotency
  USING (
    tenant_id = COALESCE(
      NULLIF(current_setting('bms.tenant_id', true), '')::uuid,
      tenant_id
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      NULLIF(current_setting('bms.tenant_id', true), '')::uuid,
      tenant_id
    )
  );

GRANT SELECT, INSERT ON bms_inventory_operation_idempotency TO bms_app;

COMMIT;

-- ROLLBACK:
-- DROP TABLE IF EXISTS bms_inventory_operation_idempotency;
