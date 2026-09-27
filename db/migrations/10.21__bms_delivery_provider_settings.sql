-- 10.21 — Platform-owned delivery provider settings
--
-- Partner credentials belong above tenants unless the signed provider contract explicitly says
-- otherwise. Tenant integrations keep store authorization/mapping only; this global control-plane
-- row records the one-time BMS partner setup. Secret columns contain AES-GCM ciphertext written by
-- the application and are never returned by the Admin API.

CREATE TABLE IF NOT EXISTS bms_delivery_provider_settings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                   TEXT NOT NULL CHECK (provider IN ('GRABFOOD','LINEMAN','FOODPANDA')),
  environment                TEXT NOT NULL CHECK (environment IN ('SANDBOX','LIVE')),
  onboarding_status          TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (onboarding_status IN ('DRAFT','CONTRACT_REVIEW','SANDBOX','CERTIFIED','ACTIVE','SUSPENDED')),
  credential_authority       TEXT NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (credential_authority IN ('UNCONFIRMED','PLATFORM','TENANT','AUTHORIZATION_FLOW')),
  authentication_mode        TEXT NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (authentication_mode IN ('UNCONFIRMED','OAUTH_CLIENT_CREDENTIALS','API_KEY','BEARER_TOKEN','SIGNED_REQUEST','CUSTOM')),
  tenant_connections_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  partner_id                 TEXT,
  client_id                  TEXT,
  client_secret_encrypted    TEXT,
  access_token_encrypted     TEXT,
  refresh_token_encrypted    TEXT,
  webhook_secret_encrypted   TEXT,
  api_base_url               TEXT,
  api_version                TEXT,
  webhook_auth_header        TEXT,
  contract_url               TEXT,
  contract_version           TEXT,
  contract_reviewed_at       TIMESTAMPTZ,
  credential_expires_at      TIMESTAMPTZ,
  config                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_test_status           TEXT NOT NULL DEFAULT 'NOT_RUN'
    CHECK (last_test_status IN ('NOT_RUN','PASSED','FAILED','CONTRACT_BLOCKED')),
  last_tested_at              TIMESTAMPTZ,
  last_error                 TEXT,
  created_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, environment)
);

CREATE TABLE IF NOT EXISTS bms_delivery_provider_setting_events (
  id             BIGSERIAL PRIMARY KEY,
  setting_id     UUID NOT NULL REFERENCES bms_delivery_provider_settings(id) ON DELETE RESTRICT,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('CREATED','UPDATED','CREDENTIAL_ROTATED','STATUS_CHANGED')),
  safe_meta      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_provider_setting_events_setting
  ON bms_delivery_provider_setting_events (setting_id, created_at DESC);

REVOKE ALL ON bms_delivery_provider_settings FROM PUBLIC;
REVOKE ALL ON bms_delivery_provider_setting_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_delivery_provider_settings TO bms_app;
GRANT SELECT, INSERT ON bms_delivery_provider_setting_events TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_delivery_provider_setting_events_id_seq TO bms_app;

COMMENT ON TABLE bms_delivery_provider_settings IS
  'Global delivery-partner control plane. Platform-admin only; secrets are application-encrypted.';
COMMENT ON TABLE bms_delivery_provider_setting_events IS
  'Append-only safe audit of platform delivery-provider configuration changes.';
