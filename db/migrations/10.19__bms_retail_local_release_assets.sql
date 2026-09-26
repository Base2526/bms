-- 10.19 — Retail Local release assets
-- Platform-owned installer distribution for Retail Local technical pilot builds.
-- The bytes still live in the shared storage driver through files; this table is
-- the release/version authority used by the public download page.

CREATE TABLE IF NOT EXISTS bms_retail_local_release_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       TEXT NOT NULL CHECK (platform IN ('windows-x64', 'ubuntu-x64', 'macos-arm64')),
  version        TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'pilot' CHECK (channel IN ('pilot', 'stable', 'internal')),
  status         TEXT NOT NULL DEFAULT 'supported' CHECK (status IN ('latest', 'supported', 'legacy', 'deprecated', 'hidden')),
  is_latest      BOOLEAN NOT NULL DEFAULT FALSE,
  file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  original_name  TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  min_os         TEXT NOT NULL,
  release_notes  TEXT NOT NULL DEFAULT '',
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep this migration usable on development databases where the release table was
-- created before macOS became an experimental distribution target.
ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_platform_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_platform_check
  CHECK (platform IN ('windows-x64', 'ubuntu-x64', 'macos-arm64'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_retail_local_release_assets_latest_platform
  ON bms_retail_local_release_assets (platform)
  WHERE is_latest;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_retail_local_release_assets_platform_version_file
  ON bms_retail_local_release_assets (platform, version, file_id);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_release_assets_public
  ON bms_retail_local_release_assets (platform, is_latest DESC, created_at DESC)
  WHERE status <> 'hidden';

CREATE OR REPLACE FUNCTION bms_touch_retail_local_release_asset()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.is_latest THEN
    NEW.status = 'latest';
  END IF;
  IF NEW.status = 'latest' THEN
    NEW.is_latest = TRUE;
  END IF;
  IF NEW.status = 'hidden' THEN
    NEW.is_latest = FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bms_touch_retail_local_release_asset ON bms_retail_local_release_assets;
CREATE TRIGGER trg_bms_touch_retail_local_release_asset
BEFORE INSERT OR UPDATE ON bms_retail_local_release_assets
FOR EACH ROW EXECUTE FUNCTION bms_touch_retail_local_release_asset();

REVOKE ALL ON bms_retail_local_release_assets FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_retail_local_release_assets TO bms_app;

COMMENT ON TABLE bms_retail_local_release_assets IS
  'Platform-managed Retail Local installer assets. Files are stored through files/storage; public downloads use the dedicated Retail Local endpoint.';
