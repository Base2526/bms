-- 10.22 — Platform-owned social authentication switches
--
-- OAuth credentials remain in the runtime secret environment. These rows only decide whether the
-- platform owner permits each provider on each pre-authentication surface. Defaults are deliberately
-- off: applying the migration must never expose a login method before a platform admin reviews it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
     WHERE lower(provider) IN ('google', 'facebook') AND provider_id IS NOT NULL
     GROUP BY lower(provider), provider_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'users contains duplicate social provider identities; resolve them before migration 10.22';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_social_provider_identity_uidx
  ON users (lower(provider), provider_id)
  WHERE lower(provider) IN ('google', 'facebook') AND provider_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_social_auth_settings (
  provider                  TEXT PRIMARY KEY CHECK (provider IN ('google', 'facebook')),
  public_login_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  admin_login_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  shop_signup_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_social_auth_setting_events (
  id                        BIGSERIAL PRIMARY KEY,
  provider                  TEXT NOT NULL CHECK (provider IN ('google', 'facebook')),
  actor_user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  previous_settings         JSONB NOT NULL,
  next_settings             JSONB NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bms_social_auth_settings (provider)
VALUES ('google'), ('facebook')
ON CONFLICT (provider) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_bms_social_auth_setting_events_provider
  ON bms_social_auth_setting_events (provider, created_at DESC);

REVOKE ALL ON bms_social_auth_settings FROM PUBLIC;
REVOKE ALL ON bms_social_auth_setting_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_social_auth_settings TO bms_app;
GRANT SELECT, INSERT ON bms_social_auth_setting_events TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_social_auth_setting_events_id_seq TO bms_app;

COMMENT ON TABLE bms_social_auth_settings IS
  'Global platform-admin switches for social auth. Credentials stay in the runtime environment.';
COMMENT ON TABLE bms_social_auth_setting_events IS
  'Append-only audit of social-auth switch changes; contains booleans only, never credentials.';
