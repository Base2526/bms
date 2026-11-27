-- Platform-owned BMS Kiosk binaries; branch grants are tenant-owned.
-- No installer is published or granted by this migration.
CREATE TABLE IF NOT EXISTS bms_kiosk_desktop_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_kind TEXT NOT NULL DEFAULT 'BMS_KIOSK' CHECK (app_kind = 'BMS_KIOSK'),
  platform TEXT NOT NULL DEFAULT 'windows-x64' CHECK (platform = 'windows-x64'),
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('pilot', 'stable')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN')),
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  signature_status TEXT NOT NULL CHECK (signature_status IN ('VALID', 'INVALID', 'UNAVAILABLE')),
  signature_checked_at TIMESTAMPTZ,
  signature_verifier TEXT,
  signer_thumbprint TEXT,
  min_os TEXT NOT NULL,
  release_notes TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  published_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_kind, platform, channel, version),
  CHECK (status <> 'PUBLISHED' OR
    (signature_status = 'VALID' AND signature_checked_at IS NOT NULL
      AND signature_verifier IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL))
);
REVOKE ALL ON bms_kiosk_desktop_releases FROM PUBLIC;
GRANT SELECT, INSERT ON bms_kiosk_desktop_releases TO bms_app;
GRANT UPDATE(status,signature_status,signature_checked_at,signature_verifier,
  signer_thumbprint,published_by,published_at,updated_at) ON bms_kiosk_desktop_releases TO bms_app;
CREATE OR REPLACE FUNCTION public.bms_kiosk_release_immutable_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.app_kind,OLD.platform,OLD.version,OLD.channel,OLD.file_id,
      OLD.original_name,OLD.size_bytes,OLD.sha256,OLD.min_os,OLD.release_notes,OLD.created_by)
    IS DISTINCT FROM
     (NEW.app_kind,NEW.platform,NEW.version,NEW.channel,NEW.file_id,
      NEW.original_name,NEW.size_bytes,NEW.sha256,NEW.min_os,NEW.release_notes,NEW.created_by)
    OR OLD.status='HIDDEN'
    OR (OLD.status='PUBLISHED' AND NEW.status='DRAFT') THEN
    RAISE EXCEPTION 'kiosk release identity and terminal state are immutable';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bms_kiosk_release_immutable_identity_trg ON bms_kiosk_desktop_releases;
CREATE TRIGGER bms_kiosk_release_immutable_identity_trg
  BEFORE UPDATE ON bms_kiosk_desktop_releases
  FOR EACH ROW EXECUTE FUNCTION public.bms_kiosk_release_immutable_identity();

CREATE TABLE IF NOT EXISTS bms_kiosk_desktop_release_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  release_id UUID NOT NULL REFERENCES bms_kiosk_desktop_releases(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, release_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bms_kiosk_desktop_release_branches_active
  ON bms_kiosk_desktop_release_branches (tenant_id, location_id, created_at DESC)
  WHERE active;
ALTER TABLE bms_kiosk_desktop_release_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_kiosk_desktop_release_branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_kiosk_desktop_release_branches_tenant ON bms_kiosk_desktop_release_branches;
CREATE POLICY bms_kiosk_desktop_release_branches_tenant ON bms_kiosk_desktop_release_branches
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
REVOKE ALL ON bms_kiosk_desktop_release_branches FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_kiosk_desktop_release_branches TO bms_app;
SELECT public.create_revision_trigger('bms_kiosk_desktop_release_branches');
-- The shared helper creates a permissive _tenant_isolation policy. Replace
-- it; a second permissive policy would be OR-ed and leak rows without a GUC.
DROP POLICY IF EXISTS bms_kiosk_desktop_release_branches_revisions_tenant_isolation
  ON bms_kiosk_desktop_release_branches_revisions;
CREATE POLICY bms_kiosk_desktop_release_branches_revisions_tenant_isolation
  ON bms_kiosk_desktop_release_branches_revisions
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

COMMENT ON TABLE bms_kiosk_desktop_releases IS
  'Platform-owned BMS Kiosk installer identity and verification evidence; never a Retail Local POS package.';
COMMENT ON TABLE bms_kiosk_desktop_release_branches IS
  'Tenant- and branch-scoped pilot authorization for published Desktop Kiosk installers.';
-- Rollback only after disabling the Kiosk release routes: revoke grants, drop
-- branch revisions/policy/table, then release table. Keep audit/file evidence.
