-- =============================================================
-- 10.12 Delivery-platform integration foundation
-- -------------------------------------------------------------
-- Durable provider boundary for GrabFood, LINE MAN and foodpanda.  This
-- migration deliberately contains no provider endpoint or payload guess:
-- verified adapters translate official contracts into these normalized rows.
--
-- Money remains on the existing order/payment/POS path. Provider settlement
-- is a server-only, non-cash payment method; later corrections are append-only
-- adjustments and never rewrite a confirmed sale or its payment.
-- =============================================================

BEGIN;

-- Platform-collected money is not a customer choice or a POS tender.  Only the
-- delivery ingestion service may create this method (enforced in application
-- code and pinned by contract tests).
ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check CHECK (method IN (
  'BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT',
  'RESERVATION_DEPOSIT','PLATFORM_SETTLEMENT'
));

-- A return may allocate a provider refund, but it remains PENDING until an
-- authenticated webhook or reconciliation confirms it.
ALTER TABLE bms_pos_refund_allocations DROP CONSTRAINT IF EXISTS bms_pos_refund_allocations_method_check;
ALTER TABLE bms_pos_refund_allocations ADD CONSTRAINT bms_pos_refund_allocations_method_check CHECK (method IN (
  'BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT',
  'RESERVATION_DEPOSIT','PLATFORM_SETTLEMENT'
));

ALTER TABLE bms_pos_return_items DROP CONSTRAINT IF EXISTS bms_pos_return_items_cancellation_cause_check;
ALTER TABLE bms_pos_return_items ADD CONSTRAINT bms_pos_return_items_cancellation_cause_check
  CHECK (cancellation_cause IS NULL OR cancellation_cause IN (
    'MERCHANT_OUT_OF_STOCK','CUSTOMER_CHANGED','PLATFORM_CANCELLED','RIDER_UNAVAILABLE',
    'ACCEPTANCE_TIMEOUT','STORE_CLOSED','INTEGRATION_FAILURE','DUPLICATE_FRAUDULENT_EVENT'
  ));

CREATE TABLE IF NOT EXISTS bms_delivery_integrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('GRABFOOD','LINEMAN','FOODPANDA')),
  environment              TEXT NOT NULL CHECK (environment IN ('SANDBOX','LIVE')),
  rollout_mode             TEXT NOT NULL DEFAULT 'OFF' CHECK (rollout_mode IN ('OFF','SHADOW','LIVE')),
  active                   BOOLEAN NOT NULL DEFAULT FALSE,
  outbound_commands_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  client_id                TEXT,
  client_secret_encrypted  TEXT,
  access_token_encrypted   TEXT,
  refresh_token_encrypted  TEXT,
  webhook_secret_encrypted TEXT,
  config                   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                             jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 32768),
  api_version              TEXT,
  credential_expires_at    TIMESTAMPTZ,
  health_status            TEXT NOT NULL DEFAULT 'UNCONFIGURED' CHECK (health_status IN (
                             'UNCONFIGURED','HEALTHY','DEGRADED','AUTH_FAILED','WEBHOOK_FAILED',
                             'RATE_LIMITED','CONTRACT_BLOCKED','DISABLED')),
  last_successful_check_at TIMESTAMPTZ,
  last_webhook_at          TIMESTAMPTZ,
  last_error               TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, provider),
  UNIQUE (tenant_id, provider, environment),
  CONSTRAINT bms_delivery_integrations_live_guard CHECK (
    environment <> 'LIVE' OR rollout_mode = 'OFF' OR (
      active AND api_version IS NOT NULL AND btrim(api_version) <> ''
      AND webhook_secret_encrypted LIKE 'enc:%'
    )
  ),
  CONSTRAINT bms_delivery_integrations_secret_shape CHECK (
    (client_secret_encrypted IS NULL OR client_secret_encrypted LIKE 'enc:%')
    AND (access_token_encrypted IS NULL OR access_token_encrypted LIKE 'enc:%')
    AND (refresh_token_encrypted IS NULL OR refresh_token_encrypted LIKE 'enc:%')
    AND (webhook_secret_encrypted IS NULL OR webhook_secret_encrypted LIKE 'enc:%')
  )
);

CREATE TABLE IF NOT EXISTS bms_delivery_location_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id    UUID NOT NULL,
  provider_store_id TEXT NOT NULL CHECK (btrim(provider_store_id) <> ''),
  provider_store_name TEXT,
  location_id       UUID NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  timezone          TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, integration_id),
  UNIQUE (tenant_id, id, integration_id, location_id),
  UNIQUE (tenant_id, integration_id, provider_store_id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bms_delivery_menu_mappings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  location_mapping_id      UUID NOT NULL,
  mapping_kind             TEXT NOT NULL CHECK (mapping_kind IN ('ITEM','VARIANT','MODIFIER')),
  provider_item_id         TEXT NOT NULL CHECK (btrim(provider_item_id) <> ''),
  provider_variant_id      TEXT,
  provider_modifier_id     TEXT,
  product_sku              TEXT,
  size                     TEXT,
  modifier_code            TEXT,
  provider_name_snapshot   TEXT NOT NULL,
  provider_price_snapshot  NUMERIC(14,2) CHECK (provider_price_snapshot IS NULL OR provider_price_snapshot >= 0),
  mapping_status           TEXT NOT NULL DEFAULT 'UNMAPPED' CHECK (mapping_status IN (
                             'UNMAPPED','SUGGESTED','VERIFIED','STALE','DISABLED')),
  verified_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at              TIMESTAMPTZ,
  provider_catalog_version TEXT,
  last_synced_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_mapping_id)
    REFERENCES bms_delivery_location_mappings(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_mapping_id, integration_id)
    REFERENCES bms_delivery_location_mappings(tenant_id, id, integration_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku),
  CONSTRAINT bms_delivery_menu_mapping_target_shape CHECK (
    (mapping_status NOT IN ('VERIFIED','STALE') OR (product_sku IS NOT NULL AND size IS NOT NULL))
    AND (mapping_kind <> 'MODIFIER' OR provider_modifier_id IS NOT NULL)
    AND (mapping_kind = 'MODIFIER' OR modifier_code IS NULL)
    AND ((verified_by IS NULL AND verified_at IS NULL)
      OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_delivery_menu_provider_identity
  ON bms_delivery_menu_mappings (
    tenant_id, location_mapping_id, mapping_kind, provider_item_id,
    COALESCE(provider_variant_id, ''), COALESCE(provider_modifier_id, '')
  );
CREATE INDEX IF NOT EXISTS idx_bms_delivery_menu_action
  ON bms_delivery_menu_mappings (tenant_id, location_mapping_id, mapping_status, updated_at);

CREATE TABLE IF NOT EXISTS bms_delivery_orders (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id             UUID NOT NULL,
  location_mapping_id        UUID NOT NULL,
  location_id                UUID NOT NULL,
  bms_order_id               UUID,
  provider                   TEXT NOT NULL CHECK (provider IN ('GRABFOOD','LINEMAN','FOODPANDA')),
  provider_order_id          TEXT NOT NULL CHECK (btrim(provider_order_id) <> ''),
  provider_display_number    TEXT,
  local_status               TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (local_status IN (
                               'RECEIVED','ACTION_REQUIRED','AWAITING_ACCEPTANCE','ACCEPTED',
                               'PREPARING','READY','HANDED_OVER','COMPLETED','REJECTED','CANCELLED','EXPIRED')),
  provider_status            TEXT,
  provider_version           TEXT,
  payment_status             TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (payment_status IN (
                               'UNVERIFIED','PLATFORM_CONFIRMED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED')),
  order_type                 TEXT NOT NULL CHECK (order_type IN ('DELIVERY','PICKUP')),
  acceptance_deadline_at     TIMESTAMPTZ,
  acceptance_claimed_at      TIMESTAMPTZ,
  acceptance_claim_token     UUID,
  scheduled_fulfillment_at   TIMESTAMPTZ,
  start_preparation_at       TIMESTAMPTZ,
  preparation_claimed_at     TIMESTAMPTZ,
  preparation_claim_token    UUID,
  promised_ready_at          TIMESTAMPTZ,
  rider_eta_at               TIMESTAMPTZ,
  currency                   TEXT NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  customer_amount            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (customer_amount >= 0),
  item_subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (item_subtotal >= 0),
  merchant_discount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (merchant_discount >= 0),
  provider_discount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (provider_discount >= 0),
  delivery_fee               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  service_fee                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  small_order_fee            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (small_order_fee >= 0),
  tax_amount                 NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  commission_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  expected_settlement_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cancellation_source        TEXT,
  cancellation_reason        TEXT,
  received_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at                TIMESTAMPTZ,
  accepted_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_device_id         UUID REFERENCES bms_pos_devices(id) ON DELETE SET NULL,
  acceptance_idempotency_key TEXT,
  acceptance_request_hash    TEXT CHECK (
                               acceptance_request_hash IS NULL OR acceptance_request_hash ~ '^[0-9a-f]{64}$'),
  preparing_at               TIMESTAMPTZ,
  ready_at                   TIMESTAMPTZ,
  handed_over_at             TIMESTAMPTZ,
  completed_at               TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,
  sanitized_metadata         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                               jsonb_typeof(sanitized_metadata) = 'object'
                               AND pg_column_size(sanitized_metadata) <= 32768),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_order_id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id, provider)
    REFERENCES bms_delivery_integrations(tenant_id, id, provider),
  FOREIGN KEY (tenant_id, location_mapping_id)
    REFERENCES bms_delivery_location_mappings(tenant_id, id),
  FOREIGN KEY (tenant_id, location_mapping_id, integration_id, location_id)
    REFERENCES bms_delivery_location_mappings(tenant_id, id, integration_id, location_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, bms_order_id)
    REFERENCES bms_orders(tenant_id, id),
  CONSTRAINT bms_delivery_orders_terminal_shape CHECK (
    (local_status <> 'COMPLETED' OR completed_at IS NOT NULL)
    AND (local_status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
    AND (local_status <> 'HANDED_OVER' OR handed_over_at IS NOT NULL)
    AND ((acceptance_claimed_at IS NULL) = (acceptance_claim_token IS NULL))
    AND ((acceptance_idempotency_key IS NULL) = (acceptance_request_hash IS NULL))
    AND ((preparation_claimed_at IS NULL) = (preparation_claim_token IS NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_orders_inbox
  ON bms_delivery_orders (tenant_id, location_id, local_status, acceptance_deadline_at, received_at);
CREATE INDEX IF NOT EXISTS idx_bms_delivery_orders_provider_state
  ON bms_delivery_orders (tenant_id, integration_id, provider_status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_delivery_orders_accept_idempotency
  ON bms_delivery_orders (tenant_id, acceptance_idempotency_key)
  WHERE acceptance_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_delivery_orders_scheduled_preparation
  ON bms_delivery_orders (start_preparation_at, received_at)
  WHERE local_status = 'ACCEPTED' AND start_preparation_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_delivery_order_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  delivery_order_id        UUID NOT NULL,
  provider_line_id         TEXT NOT NULL,
  provider_item_id         TEXT NOT NULL,
  provider_variant_id      TEXT,
  bms_order_item_id        BIGINT,
  name_snapshot            TEXT NOT NULL,
  quantity                 INTEGER NOT NULL CHECK (quantity > 0),
  unit_price               NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  mapped_sku               TEXT,
  mapped_size              TEXT,
  status                   TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','REFUNDED')),
  source_version           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_order_id, provider_line_id),
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, bms_order_item_id)
    REFERENCES bms_order_items(tenant_id, id),
  FOREIGN KEY (tenant_id, mapped_sku)
    REFERENCES bms_products(tenant_id, sku),
  CHECK ((mapped_sku IS NULL) = (mapped_size IS NULL))
);

CREATE TABLE IF NOT EXISTS bms_delivery_order_modifiers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  delivery_order_line_id   UUID NOT NULL,
  provider_modifier_id     TEXT NOT NULL,
  provider_name_snapshot   TEXT NOT NULL,
  mapped_modifier_code     TEXT,
  quantity                 INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_snapshot           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price_snapshot >= 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_order_line_id)
    REFERENCES bms_delivery_order_lines(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_delivery_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  external_event_id        TEXT NOT NULL CHECK (btrim(external_event_id) <> ''),
  event_type               TEXT NOT NULL,
  provider_sequence        BIGINT,
  provider_version         TEXT,
  provider_occurred_at     TIMESTAMPTZ,
  received_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_hash             TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  sanitized_payload        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                               jsonb_typeof(sanitized_payload) = 'object'
                               AND pg_column_size(sanitized_payload) <= 65536),
  processing_status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (processing_status IN (
                               'PENDING','PROCESSING','PROCESSED','ACTION_REQUIRED','RETRY','DEAD_LETTER','IGNORED_OLD')),
  attempts                 INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at               TIMESTAMPTZ,
  claim_token              UUID,
  processed_at             TIMESTAMPTZ,
  error_code               TEXT,
  last_error               TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, integration_id, external_event_id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT bms_delivery_events_claim_shape CHECK (
    (processing_status = 'PROCESSING' AND claimed_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (processing_status <> 'PROCESSING' AND claimed_at IS NULL AND claim_token IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_events_claim
  ON bms_delivery_events (available_at, received_at)
  WHERE processing_status IN ('PENDING','RETRY','PROCESSING');

CREATE TABLE IF NOT EXISTS bms_delivery_commands (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  delivery_order_id        UUID,
  command_type             TEXT NOT NULL,
  aggregate_type           TEXT NOT NULL,
  aggregate_id             TEXT NOT NULL,
  desired_state            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                               jsonb_typeof(desired_state) = 'object' AND pg_column_size(desired_state) <= 32768),
  idempotency_key          TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash             TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status                   TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                               'PENDING','PROCESSING','SUCCEEDED','RETRY','FAILED','CANCELLED','MANUAL_ACTION_REQUIRED')),
  attempts                 INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at               TIMESTAMPTZ,
  claim_token              UUID,
  provider_response_ref    TEXT,
  last_error               TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, integration_id, idempotency_key),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id),
  CONSTRAINT bms_delivery_commands_claim_shape CHECK (
    (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (status <> 'PROCESSING' AND claimed_at IS NULL AND claim_token IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_commands_claim
  ON bms_delivery_commands (next_retry_at, created_at)
  WHERE status IN ('PENDING','RETRY','PROCESSING');

CREATE TABLE IF NOT EXISTS bms_delivery_intake_controls (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id              UUID,
  integration_id           UUID,
  scope                    TEXT NOT NULL CHECK (scope IN (
                               'ALL_ONLINE','DELIVERY_PLATFORMS','CHAT_WEB','BRANCH','PROVIDER')),
  desired_state            TEXT NOT NULL CHECK (desired_state IN ('ACCEPTING','PAUSED')),
  provider_state           TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (provider_state IN (
                               'UNKNOWN','ACCEPTING','PAUSED','UNSUPPORTED')),
  sync_status              TEXT NOT NULL DEFAULT 'LOCAL_ONLY' CHECK (sync_status IN (
                               'LOCAL_ONLY','PENDING','SYNCED','FAILED','MANUAL_PROVIDER_ACTION_REQUIRED')),
  reason                   TEXT CHECK (reason IS NULL OR length(reason) <= 240),
  paused_until             TIMESTAMPTZ,
  version                  BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  changed_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id                UUID,
  last_idempotency_key     TEXT,
  last_request_hash        TEXT,
  last_synced_at           TIMESTAMPTZ,
  last_error               TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT bms_delivery_intake_scope_shape CHECK (
    (scope IN ('ALL_ONLINE','DELIVERY_PLATFORMS','CHAT_WEB') AND location_id IS NULL AND integration_id IS NULL)
    OR (scope = 'BRANCH' AND location_id IS NOT NULL AND integration_id IS NULL)
    OR (scope = 'PROVIDER' AND location_id IS NOT NULL AND integration_id IS NOT NULL)
  ),
  CONSTRAINT bms_delivery_intake_idempotency_shape CHECK (
    (last_idempotency_key IS NULL) = (last_request_hash IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_delivery_intake_scope
  ON bms_delivery_intake_controls (
    tenant_id, scope, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(integration_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_delivery_intake_idempotency
  ON bms_delivery_intake_controls (tenant_id, last_idempotency_key)
  WHERE last_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_delivery_intake_resume
  ON bms_delivery_intake_controls (paused_until)
  WHERE desired_state = 'PAUSED' AND paused_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_delivery_order_events (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  delivery_order_id        UUID NOT NULL,
  event_kind               TEXT NOT NULL,
  actor_type               TEXT NOT NULL CHECK (actor_type IN (
                               'SYSTEM','ADMIN','USER','POS_DEVICE','PROVIDER','JOB','WEBHOOK')),
  actor_id                 TEXT,
  source                   TEXT NOT NULL,
  safe_detail              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                               jsonb_typeof(safe_detail) = 'object' AND pg_column_size(safe_detail) <= 16384),
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_order_timeline
  ON bms_delivery_order_events (tenant_id, delivery_order_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS bms_delivery_handoffs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  delivery_order_id        UUID NOT NULL,
  pickup_code_hash         TEXT,
  pickup_code_display      TEXT CHECK (pickup_code_display IS NULL OR length(pickup_code_display) <= 8),
  bag_count                INTEGER NOT NULL CHECK (bag_count > 0),
  checklist                JSONB NOT NULL CHECK (jsonb_typeof(checklist) = 'object'),
  rider_reference          TEXT,
  handed_over_by           UUID NOT NULL REFERENCES users(id),
  device_id                UUID NOT NULL,
  idempotency_key          TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash             TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  handed_over_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_ack_status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (provider_ack_status IN (
                               'PENDING','CONFIRMED','FAILED','MANUAL_ACTION_REQUIRED')),
  provider_ack_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_order_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bms_delivery_settlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  provider                 TEXT NOT NULL CHECK (provider IN ('GRABFOOD','LINEMAN','FOODPANDA')),
  period_start             TIMESTAMPTZ NOT NULL,
  period_end               TIMESTAMPTZ NOT NULL,
  statement_reference      TEXT NOT NULL,
  source                   TEXT NOT NULL CHECK (source IN ('API','FILE','MANUAL')),
  gross_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_amount               NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_net_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_net_amount        NUMERIC(14,2),
  currency                 TEXT NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                               'OPEN','MATCHED','MISMATCH','DISPUTED','CLOSED')),
  imported_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, integration_id, statement_reference),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id, provider)
    REFERENCES bms_delivery_integrations(tenant_id, id, provider),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS bms_delivery_settlement_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  settlement_id            UUID NOT NULL,
  delivery_order_id        UUID,
  bms_order_id             UUID,
  provider_order_id        TEXT NOT NULL,
  gross_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_amount               NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_net_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  reconciliation_status    TEXT NOT NULL CHECK (reconciliation_status IN (
                               'MATCHED','MISSING_ORDER','MISSING_SETTLEMENT','AMOUNT_MISMATCH',
                               'REFUND_MISMATCH','ADJUSTED','DISPUTED')),
  safe_detail              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_detail) = 'object'),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, settlement_id, provider_order_id),
  FOREIGN KEY (tenant_id, settlement_id)
    REFERENCES bms_delivery_settlements(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, bms_order_id)
    REFERENCES bms_orders(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bms_delivery_adjustments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  delivery_order_id        UUID,
  settlement_line_id       UUID,
  adjustment_type          TEXT NOT NULL CHECK (adjustment_type IN (
                               'CHARGEBACK','PENALTY','REFUND','PROVIDER_CORRECTION','APPEAL_RESULT')),
  amount                   NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  currency                 TEXT NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  provider_reference       TEXT,
  reason                   TEXT NOT NULL CHECK (btrim(reason) <> ''),
  effective_at             TIMESTAMPTZ NOT NULL,
  recorded_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_line_id)
    REFERENCES bms_delivery_settlement_lines(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bms_delivery_disputes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  integration_id           UUID NOT NULL,
  delivery_order_id        UUID,
  provider_case_id         TEXT,
  reason                   TEXT NOT NULL CHECK (btrim(reason) <> ''),
  claimed_amount           NUMERIC(14,2) NOT NULL CHECK (claimed_amount >= 0),
  currency                 TEXT NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  status                   TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                               'DRAFT','SUBMITTED','UNDER_REVIEW','WON','LOST','CANCELLED')),
  submitted_at             TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, integration_id, provider_case_id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES bms_delivery_integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_order_id)
    REFERENCES bms_delivery_orders(tenant_id, id),
  CONSTRAINT bms_delivery_disputes_lifecycle_shape CHECK (
    (status NOT IN ('SUBMITTED','UNDER_REVIEW','WON','LOST') OR submitted_at IS NOT NULL)
    AND (status NOT IN ('WON','LOST') OR resolved_at IS NOT NULL)
  )
);

-- A join table, rather than file ids in JSON, lets PostgreSQL enforce that
-- evidence is owned by the same tenant. /api/files still enforces private
-- visibility and tenant authorization when the bytes are read.
CREATE UNIQUE INDEX IF NOT EXISTS uq_files_tenant_id_id ON files (tenant_id, id);
CREATE TABLE IF NOT EXISTS bms_delivery_dispute_evidence (
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  dispute_id               UUID NOT NULL,
  file_id                  INTEGER NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dispute_id, file_id),
  FOREIGN KEY (tenant_id, dispute_id)
    REFERENCES bms_delivery_disputes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id)
    REFERENCES files(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bms_delivery_settlements_period
  ON bms_delivery_settlements (tenant_id, integration_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_bms_delivery_adjustments_order
  ON bms_delivery_adjustments (tenant_id, delivery_order_id, effective_at);
CREATE INDEX IF NOT EXISTS idx_bms_delivery_disputes_status
  ON bms_delivery_disputes (tenant_id, status, updated_at);

-- RLS on every delivery-owned table. Tenant GUC is mandatory: unlike old
-- fallback policies, an unset tenant never means "all rows".
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_delivery_integrations','bms_delivery_location_mappings','bms_delivery_menu_mappings',
    'bms_delivery_orders','bms_delivery_order_lines','bms_delivery_order_modifiers',
    'bms_delivery_events','bms_delivery_commands','bms_delivery_intake_controls',
    'bms_delivery_order_events','bms_delivery_handoffs','bms_delivery_settlements',
    'bms_delivery_settlement_lines','bms_delivery_adjustments','bms_delivery_disputes',
    'bms_delivery_dispute_evidence'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON
  bms_delivery_integrations, bms_delivery_location_mappings, bms_delivery_menu_mappings,
  bms_delivery_orders, bms_delivery_order_lines, bms_delivery_order_modifiers,
  bms_delivery_events, bms_delivery_commands, bms_delivery_intake_controls,
  bms_delivery_order_events, bms_delivery_handoffs, bms_delivery_settlements,
  bms_delivery_settlement_lines, bms_delivery_adjustments, bms_delivery_disputes,
  bms_delivery_dispute_evidence
  TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_delivery_order_events_id_seq TO bms_app;

-- Cross-tenant workers may only claim bounded due work through these narrow
-- functions. Business processing re-enters a normal tenant transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_delivery_worker') THEN
    CREATE ROLE bms_delivery_worker NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE bms_delivery_worker NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO bms_delivery_worker;
GRANT SELECT, UPDATE ON bms_delivery_events, bms_delivery_commands, bms_delivery_orders TO bms_delivery_worker;
GRANT SELECT ON bms_delivery_integrations, bms_delivery_intake_controls TO bms_delivery_worker;

-- Webhooks have no tenant session yet. Resolve exactly one opaque integration id
-- through a narrow definer function, then re-enter normal tenant RLS for writes.
CREATE OR REPLACE FUNCTION public.bms_resolve_delivery_webhook_integration(p_id UUID)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  provider TEXT,
  environment TEXT,
  active BOOLEAN,
  rollout_mode TEXT,
  webhook_secret_encrypted TEXT,
  api_version TEXT,
  config JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.tenant_id, i.provider, i.environment, i.active, i.rollout_mode,
         i.webhook_secret_encrypted, i.api_version, i.config
    FROM public.bms_delivery_integrations i
   WHERE i.id = p_id
   LIMIT 1
$$;
ALTER FUNCTION public.bms_resolve_delivery_webhook_integration(UUID) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_resolve_delivery_webhook_integration(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_resolve_delivery_webhook_integration(UUID) TO bms_app;

CREATE OR REPLACE FUNCTION public.bms_claim_delivery_events(p_limit INTEGER, p_lease_ms INTEGER)
RETURNS SETOF public.bms_delivery_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_ms < 1000 OR p_lease_ms > 900000 THEN
    RAISE EXCEPTION 'invalid delivery event claim bounds';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id FROM public.bms_delivery_events e
     WHERE e.available_at <= clock_timestamp()
       AND (e.processing_status IN ('PENDING','RETRY')
         OR (e.processing_status = 'PROCESSING'
           AND e.claimed_at < clock_timestamp() - p_lease_ms * interval '1 millisecond'))
     ORDER BY e.available_at, e.received_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.bms_delivery_events e
     SET processing_status = 'PROCESSING', claimed_at = clock_timestamp(),
         claim_token = gen_random_uuid(), attempts = attempts + 1,
         last_error = NULL, updated_at = clock_timestamp()
    FROM candidates c WHERE e.id = c.id
  RETURNING e.*;
END $$;
ALTER FUNCTION public.bms_claim_delivery_events(INTEGER, INTEGER) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_claim_delivery_events(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_claim_delivery_events(INTEGER, INTEGER) TO bms_app;

CREATE OR REPLACE FUNCTION public.bms_claim_delivery_commands(p_limit INTEGER, p_lease_ms INTEGER)
RETURNS SETOF public.bms_delivery_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_ms < 1000 OR p_lease_ms > 900000 THEN
    RAISE EXCEPTION 'invalid delivery command claim bounds';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT c.id FROM public.bms_delivery_commands c
     JOIN public.bms_delivery_integrations i
       ON i.tenant_id = c.tenant_id AND i.id = c.integration_id
     WHERE c.next_retry_at <= clock_timestamp()
       AND i.active AND i.outbound_commands_enabled AND i.rollout_mode = 'LIVE'
       AND (c.status IN ('PENDING','RETRY')
         OR (c.status = 'PROCESSING'
           AND c.claimed_at < clock_timestamp() - p_lease_ms * interval '1 millisecond'))
     ORDER BY c.next_retry_at, c.created_at
     FOR UPDATE OF c SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.bms_delivery_commands c
     SET status = 'PROCESSING', claimed_at = clock_timestamp(), claim_token = gen_random_uuid(),
         attempts = attempts + 1, last_error = NULL, updated_at = clock_timestamp()
    FROM candidates x WHERE c.id = x.id
  RETURNING c.*;
END $$;
ALTER FUNCTION public.bms_claim_delivery_commands(INTEGER, INTEGER) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_claim_delivery_commands(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_claim_delivery_commands(INTEGER, INTEGER) TO bms_app;

CREATE OR REPLACE FUNCTION public.bms_due_delivery_intake_controls(p_limit INTEGER)
RETURNS TABLE(tenant_id UUID, id UUID, version BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.tenant_id, c.id, c.version
    FROM public.bms_delivery_intake_controls c
   WHERE c.desired_state = 'PAUSED'
     AND c.paused_until IS NOT NULL
     AND c.paused_until <= clock_timestamp()
   ORDER BY c.paused_until, c.id
   LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;
ALTER FUNCTION public.bms_due_delivery_intake_controls(INTEGER) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_due_delivery_intake_controls(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_due_delivery_intake_controls(INTEGER) TO bms_app;

CREATE OR REPLACE FUNCTION public.bms_claim_due_delivery_preparation(p_limit INTEGER, p_lease_ms INTEGER)
RETURNS TABLE(tenant_id UUID, delivery_order_id UUID, bms_order_id UUID, claim_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
      FROM public.bms_delivery_orders d
     WHERE d.local_status = 'ACCEPTED'
       AND d.bms_order_id IS NOT NULL
       AND d.start_preparation_at IS NOT NULL
       AND d.start_preparation_at <= clock_timestamp()
       AND (d.preparation_claimed_at IS NULL
         OR d.preparation_claimed_at < clock_timestamp() - (LEAST(GREATEST(p_lease_ms, 1000), 600000) * interval '1 millisecond'))
     ORDER BY d.start_preparation_at, d.received_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.bms_delivery_orders d
     SET preparation_claimed_at = clock_timestamp(), preparation_claim_token = gen_random_uuid(), updated_at = clock_timestamp()
    FROM candidates c WHERE d.id = c.id
  RETURNING d.tenant_id, d.id, d.bms_order_id, d.preparation_claim_token;
END $$;
ALTER FUNCTION public.bms_claim_due_delivery_preparation(INTEGER, INTEGER) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_claim_due_delivery_preparation(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_claim_due_delivery_preparation(INTEGER, INTEGER) TO bms_app;

CREATE OR REPLACE FUNCTION public.bms_claim_expired_delivery_acceptance(p_limit INTEGER, p_lease_ms INTEGER)
RETURNS TABLE(tenant_id UUID, delivery_order_id UUID, claim_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
      FROM public.bms_delivery_orders d
     WHERE d.local_status IN ('RECEIVED','AWAITING_ACCEPTANCE')
       AND d.acceptance_deadline_at IS NOT NULL
       AND d.acceptance_deadline_at <= clock_timestamp()
       AND (d.acceptance_claimed_at IS NULL
         OR d.acceptance_claimed_at < clock_timestamp() - (LEAST(GREATEST(p_lease_ms, 1000), 600000) * interval '1 millisecond'))
     ORDER BY d.acceptance_deadline_at, d.received_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.bms_delivery_orders d
     SET acceptance_claimed_at=clock_timestamp(),acceptance_claim_token=gen_random_uuid(),updated_at=clock_timestamp()
    FROM candidates c WHERE d.id=c.id
  RETURNING d.tenant_id,d.id,d.acceptance_claim_token;
END $$;
ALTER FUNCTION public.bms_claim_expired_delivery_acceptance(INTEGER, INTEGER) OWNER TO bms_delivery_worker;
REVOKE ALL ON FUNCTION public.bms_claim_expired_delivery_acceptance(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_claim_expired_delivery_acceptance(INTEGER, INTEGER) TO bms_app;

-- Manager receives configuration/finance authority. Cashier and Sales can
-- review and hand over orders, but cannot change credentials, mappings,
-- settlement or pause state. Administrator remains the code-level super-role.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','delivery.integration.view'),
  ('Manager','delivery.integration.manage'),
  ('Manager','delivery.mapping.manage'),
  ('Manager','restaurant.order_intake.manage'),
  ('Manager','restaurant.delivery.review'),
  ('Manager','restaurant.delivery.handoff'),
  ('Manager','delivery.settlement.view'),
  ('Manager','delivery.settlement.manage'),
  ('Manager','delivery.dispute.manage'),
  ('Sales','restaurant.delivery.review'),
  ('Sales','restaurant.delivery.handoff'),
  ('Cashier','restaurant.delivery.review'),
  ('Cashier','restaurant.delivery.handoff')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

SELECT public.create_revision_trigger('bms_delivery_integrations');
SELECT public.create_revision_trigger('bms_delivery_location_mappings');
SELECT public.create_revision_trigger('bms_delivery_menu_mappings');
SELECT public.create_revision_trigger('bms_delivery_orders');
SELECT public.create_revision_trigger('bms_delivery_intake_controls');
SELECT public.create_revision_trigger('bms_delivery_handoffs');
SELECT public.create_revision_trigger('bms_delivery_settlements');
SELECT public.create_revision_trigger('bms_delivery_adjustments');
SELECT public.create_revision_trigger('bms_delivery_disputes');

COMMENT ON TABLE bms_delivery_events IS
  'Verified, deduplicated webhook inbox. Raw provider payloads and PII do not belong here.';
COMMENT ON TABLE bms_delivery_commands IS
  'Transactional outbound command outbox. Provider calls happen only after the owning transaction commits.';
COMMENT ON TABLE bms_delivery_adjustments IS
  'Append-only provider financial corrections; never rewrite the original sale or payment.';

COMMIT;

-- ROLLBACK (feature rollback normally uses rollout_mode=OFF and preserves
-- history; destructive schema rollback is only for an empty pre-pilot DB):
-- BEGIN;
-- DROP TABLE bms_delivery_dispute_evidence, bms_delivery_disputes,
--   bms_delivery_adjustments, bms_delivery_settlement_lines, bms_delivery_settlements,
--   bms_delivery_handoffs, bms_delivery_order_events, bms_delivery_intake_controls,
--   bms_delivery_commands, bms_delivery_events, bms_delivery_order_modifiers,
--   bms_delivery_order_lines, bms_delivery_orders, bms_delivery_menu_mappings,
--   bms_delivery_location_mappings, bms_delivery_integrations;
-- DELETE FROM bms_role_permissions WHERE permission LIKE 'delivery.%'
--   OR permission IN ('restaurant.order_intake.manage','restaurant.delivery.review','restaurant.delivery.handoff');
-- Reapply the latest payment-method constraints from the prior migration.
-- COMMIT;
