-- 10.29 - Add macOS Intel to Retail Local release assets

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_platform_check;

ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_platform_check
  CHECK (platform IN ('windows-x64', 'ubuntu-x64', 'macos-arm64', 'macos-x64'));
