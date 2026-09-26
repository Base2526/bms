-- 10.20 - Retail Local release package types
-- A platform can publish separate full, server-only, and POS-only installers.

ALTER TABLE bms_retail_local_release_assets
  ADD COLUMN IF NOT EXISTS package_type TEXT NOT NULL DEFAULT 'server';

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_package_type_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_package_type_check
  CHECK (package_type IN ('server-pos', 'server', 'pos'));

DROP INDEX IF EXISTS uq_bms_retail_local_release_assets_latest_platform;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_retail_local_release_assets_latest_package
  ON bms_retail_local_release_assets (platform, package_type)
  WHERE is_latest;

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_release_assets_public_package
  ON bms_retail_local_release_assets (platform, package_type, is_latest DESC, created_at DESC)
  WHERE status <> 'hidden';

COMMENT ON COLUMN bms_retail_local_release_assets.package_type IS
  'Installer role: combined server-pos, server-only, or POS Desktop-only.';
