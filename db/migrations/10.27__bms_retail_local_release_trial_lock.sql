-- 10.27 - Trial-lock Retail Local combined Server + POS packages
-- The combined installer carries the server runtime and a paired POS client,
-- so distribution belongs behind the control plane trial/paid flow instead of
-- the anonymous public download list. This is a package distribution lock only;
-- it must never become a runtime lease or installed-shop entitlement check.

ALTER TABLE bms_retail_local_release_assets
  ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'public';

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_access_level_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_access_level_check
  CHECK (access_level IN ('public', 'trial'));

UPDATE bms_retail_local_release_assets
   SET access_level = 'trial'
 WHERE package_type = 'server-pos'
   AND access_level <> 'trial';

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_server_pos_trial_lock_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_assets_server_pos_trial_lock_check
  CHECK (package_type <> 'server-pos' OR access_level = 'trial');

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_release_assets_public_unlocked
  ON bms_retail_local_release_assets (platform, package_type, is_latest DESC, created_at DESC)
  WHERE status <> 'hidden' AND access_level = 'public';

COMMENT ON COLUMN bms_retail_local_release_assets.access_level IS
  'Distribution access only: public assets appear on /retail-local; trial assets require platform control-plane handling and never affect installed shop runtime.';
