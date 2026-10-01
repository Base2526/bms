-- Pre-install evidence is platform-owned, not a tenant or a device identity.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_installer_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash CHAR(64) NOT NULL UNIQUE,
  fingerprint CHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('windows','linux','macos','unknown')),
  architecture VARCHAR(16) NOT NULL,
  product VARCHAR(16) NOT NULL CHECK (product IN ('pos','server-pos')),
  installer_version VARCHAR(128) NOT NULL,
  os_version VARCHAR(128) NOT NULL,
  stage VARCHAR(128) NOT NULL,
  report JSONB NOT NULL CHECK (octet_length(report::text) <= 32768),
  status VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','INVESTIGATING','RESOLVED')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2048),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_installer_reports_received ON bms_installer_reports(received_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_installer_reports_group ON bms_installer_reports(fingerprint, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_installer_reports_filter ON bms_installer_reports(platform, installer_version, status);
CREATE INDEX IF NOT EXISTS idx_installer_reports_expiry ON bms_installer_reports(expires_at);
REVOKE ALL ON bms_installer_reports FROM PUBLIC;
-- No tenant runtime role access: every read/mutation requires platform-admin authority.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bms_app') THEN
    REVOKE ALL ON bms_installer_reports FROM bms_app;
  END IF;
END $$;
COMMIT;
