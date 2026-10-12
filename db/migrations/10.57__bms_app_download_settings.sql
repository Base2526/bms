-- Platform-owned homepage download links. Empty values keep visitors on the homepage.
CREATE TABLE IF NOT EXISTS bms_app_download_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  android_url TEXT NOT NULL DEFAULT '' CHECK (length(android_url) <= 2048),
  ios_url TEXT NOT NULL DEFAULT '' CHECK (length(ios_url) <= 2048),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bms_app_download_settings (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;
REVOKE ALL ON bms_app_download_settings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_app_download_settings TO bms_app;
COMMENT ON TABLE bms_app_download_settings IS
  'Global public download URLs. Writes require platform administrator authorization; not tenant-owned.';
