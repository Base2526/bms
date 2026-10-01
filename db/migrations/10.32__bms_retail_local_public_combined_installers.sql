-- 10.32 - Allow combined Retail Local installers on the public download page
-- Download access and first-install activation are separate controls. A public
-- Server + POS bootstrap still requires its configured one-time activation code
-- during onboarding, while an already-installed shop remains fail-open.

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_server_pos_trial_lock_check;

COMMENT ON COLUMN bms_retail_local_release_assets.access_level IS
  'Installer distribution only: public assets appear on /retail-local; onboarding-only assets require platform-admin delivery. This never affects installed shop runtime.';
