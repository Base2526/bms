-- 10.33 - Publish legacy Windows x86 POS Desktop release assets
-- The local server runtime remains x64-only. This platform is deliberately
-- restricted to the POS client so an x86 machine can never be advertised as a
-- Retail Local server or combined Server + POS host.

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_platform_check;

ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_platform_check
  CHECK (platform IN ('windows-x64', 'windows-x86-legacy', 'ubuntu-x64', 'macos-arm64', 'macos-x64'));

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_windows_x86_pos_only_check;

ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_windows_x86_pos_only_check
  CHECK (platform <> 'windows-x86-legacy' OR package_type = 'pos');
