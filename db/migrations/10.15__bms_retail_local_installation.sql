-- =============================================================
-- 10.15  Retail Local installation identity
-- -------------------------------------------------------------
-- Cloud deployments leave this singleton table empty. A Retail Local first-run
-- provisioner writes exactly one row after tenant, owner, branch, and POS device
-- have committed in the same transaction. No raw device token or password is
-- stored here.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_local_installation (
  singleton       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  deployment_mode TEXT NOT NULL CHECK (deployment_mode = 'retail-local'),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES bms_tenants(id) ON DELETE RESTRICT,
  admin_user_id   UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  pos_device_id   UUID NOT NULL UNIQUE REFERENCES bms_pos_devices(id) ON DELETE RESTRICT,
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bms_local_installation IS
  'Empty on Cloud. Singleton authority for a provisioned single-store Retail Local deployment; contains identifiers only, never credentials.';

ALTER TABLE bms_local_installation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bms_local_installation_tenant_isolation ON bms_local_installation;
CREATE POLICY bms_local_installation_tenant_isolation ON bms_local_installation
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- Provisioning is an owner/superuser-only one-shot job. The runtime bms_app role
-- has no reason to read installation identity through application requests.
REVOKE ALL ON bms_local_installation FROM PUBLIC;
REVOKE ALL ON bms_local_installation FROM bms_app;

