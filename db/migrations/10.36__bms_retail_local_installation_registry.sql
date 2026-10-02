-- Anonymous operational registry for successful Retail Local installations.
-- One row is one installation instance, not a download and not a hardware identity.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_retail_local_installation_registry (
  installation_id UUID PRIMARY KEY,
  secret_hash CHAR(64) NOT NULL,
  package_type VARCHAR(16) NOT NULL CHECK (package_type IN ('pos','server','server-pos')),
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('windows','linux','macos','unknown')),
  architecture VARCHAR(16) NOT NULL CHECK (architecture IN ('x86','x64','arm64','unknown')),
  os_version VARCHAR(128) NOT NULL,
  platform_target VARCHAR(128) NOT NULL,
  release_version VARCHAR(128) NOT NULL,
  agent_version VARCHAR(64) NOT NULL,
  tenant_reference VARCHAR(128),
  license_reference VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNINSTALLED')),
  installed_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event VARCHAR(16) NOT NULL CHECK (last_event IN ('INSTALLED','SEEN','UPDATED','UNINSTALLED')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retail_local_install_registry_seen
  ON bms_retail_local_installation_registry(last_seen_at DESC, installation_id);
CREATE INDEX IF NOT EXISTS idx_retail_local_install_registry_dimensions
  ON bms_retail_local_installation_registry(platform, architecture, package_type, release_version);
REVOKE ALL ON bms_retail_local_installation_registry FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bms_app') THEN
    REVOKE ALL ON bms_retail_local_installation_registry FROM bms_app;
  END IF;
END $$;
COMMENT ON TABLE bms_retail_local_installation_registry IS
  'Self-reported successful installation instances; random identity only, never hardware fingerprinting or licensing authority.';
COMMIT;
