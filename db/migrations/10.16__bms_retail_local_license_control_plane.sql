-- =============================================================
-- 10.16  Retail Local license evidence control plane
-- -------------------------------------------------------------
-- Platform-global commercial evidence only. These rows never participate in
-- local runtime readiness, POS, payment, stock, data access, backup or restore.
-- A review status is a back-office task, never a remote kill switch.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_retail_local_licenses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_code             VARCHAR(128) NOT NULL UNIQUE,
  customer_reference       VARCHAR(128),
  status                   VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'REVIEW_REQUIRED', 'CLOSED')),
  max_active_installations INTEGER NOT NULL DEFAULT 1
                             CHECK (max_active_installations BETWEEN 1 AND 100),
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_retail_local_license_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  label       VARCHAR(128) NOT NULL DEFAULT 'installation',
  issued_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bms_retail_local_license_installations (
  installation_id      UUID PRIMARY KEY,
  license_id           UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  device_key_thumbprint CHAR(64) NOT NULL CHECK (device_key_thumbprint ~ '^[a-f0-9]{64}$'),
  device_public_key    VARCHAR(43) NOT NULL,
  tenant_reference    VARCHAR(128),
  pos_device_reference VARCHAR(128),
  platform_target     VARCHAR(128) NOT NULL,
  release_version     VARCHAR(128) NOT NULL,
  status              VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'REVIEW_REQUIRED', 'DEACTIVATED', 'TRANSFERRED')),
  last_sequence       BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_event_hash     CHAR(64),
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at      TIMESTAMPTZ,
  UNIQUE (license_id, device_key_thumbprint)
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_license_installations_review
  ON bms_retail_local_license_installations (license_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS bms_retail_local_license_events (
  event_id             UUID PRIMARY KEY,
  license_id           UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  installation_id      UUID NOT NULL,
  event_type           VARCHAR(40) NOT NULL,
  sequence             BIGINT NOT NULL CHECK (sequence > 0),
  previous_event_hash  CHAR(64),
  event_hash           CHAR(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  occurred_at          TIMESTAMPTZ NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform_target      VARCHAR(128) NOT NULL,
  release_version      VARCHAR(128) NOT NULL,
  verification_status VARCHAR(24) NOT NULL
                        CHECK (verification_status IN ('ACCEPTED', 'REVIEW_REQUIRED')),
  review_reason        VARCHAR(128),
  envelope             JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_license_events_timeline
  ON bms_retail_local_license_events (license_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_retail_local_license_events_accepted_sequence
  ON bms_retail_local_license_events (installation_id, sequence)
  WHERE verification_status = 'ACCEPTED';

CREATE TABLE IF NOT EXISTS bms_retail_local_license_reviews (
  id                BIGSERIAL PRIMARY KEY,
  license_id        UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  installation_id   UUID,
  event_id          UUID REFERENCES bms_retail_local_license_events(event_id) ON DELETE SET NULL,
  reason            VARCHAR(128) NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'RESOLVED')),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution        VARCHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_retail_local_license_reviews_open
  ON bms_retail_local_license_reviews (license_id, installation_id, reason)
  WHERE status = 'OPEN';

REVOKE ALL ON bms_retail_local_licenses,
  bms_retail_local_license_tokens,
  bms_retail_local_license_installations,
  bms_retail_local_license_events,
  bms_retail_local_license_reviews FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON bms_retail_local_licenses,
  bms_retail_local_license_tokens,
  bms_retail_local_license_installations,
  bms_retail_local_license_events,
  bms_retail_local_license_reviews TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_retail_local_license_reviews_id_seq TO bms_app;

COMMENT ON TABLE bms_retail_local_license_events IS
  'Append-only signed Retail Local license evidence; never consulted by a shop transaction path.';
COMMENT ON TABLE bms_retail_local_license_reviews IS
  'Human back-office review queue. OPEN never disables an installed shop.';

COMMIT;
