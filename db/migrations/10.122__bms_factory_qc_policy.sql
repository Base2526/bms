BEGIN;
-- Opt-in quality gate for produced lots. A policy never releases an existing hold.
CREATE TABLE IF NOT EXISTS bms_factory_qc_policies (
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  product_sku text NOT NULL,
  size text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  due_minutes integer NOT NULL DEFAULT 1440 CHECK (due_minutes BETWEEN 1 AND 10080),
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, location_id, product_sku, size),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, product_sku, size)
    REFERENCES bms_product_variants(tenant_id, product_sku, code)
);
ALTER TABLE bms_factory_qc_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_factory_qc_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_factory_qc_policies;
CREATE POLICY tenant_isolation ON bms_factory_qc_policies
  USING (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON bms_factory_qc_policies TO bms_app;
GRANT UPDATE(required, due_minutes, version, updated_by, updated_at)
  ON bms_factory_qc_policies TO bms_app;
COMMIT;
-- ROLLBACK: disable policy writes and production posts before application rollback.
-- Retain the policy and every ACTIVE quality hold; never auto-release a produced lot.
