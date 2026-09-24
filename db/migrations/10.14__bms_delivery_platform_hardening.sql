-- =============================================================
-- 10.14 Delivery-platform lifecycle hardening
-- -------------------------------------------------------------
-- Keep provider transport and integration configuration identity as typed,
-- lockable database facts. Provider-call attempts are intentionally separate
-- from local inbox/outbox claim attempts: one local command can make a token
-- request plus a bounded 401 retry without changing its idempotency identity.
-- =============================================================

BEGIN;

ALTER TABLE bms_delivery_integrations
  ADD COLUMN IF NOT EXISTS config_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE bms_delivery_integrations
  DROP CONSTRAINT IF EXISTS bms_delivery_integrations_config_version_check;
ALTER TABLE bms_delivery_integrations
  ADD CONSTRAINT bms_delivery_integrations_config_version_check
  CHECK (config_version > 0);

ALTER TABLE bms_delivery_orders
  ADD COLUMN IF NOT EXISTS transport_type TEXT;

ALTER TABLE bms_delivery_orders
  DROP CONSTRAINT IF EXISTS bms_delivery_orders_transport_type_check;
ALTER TABLE bms_delivery_orders
  ADD CONSTRAINT bms_delivery_orders_transport_type_check
  CHECK (transport_type IS NULL OR transport_type IN ('LOGISTICS_DELIVERY','VENDOR_DELIVERY'));

-- Backfill only values that were already allowlisted by the 10.12 adapter.
-- NULL remains an explicit legacy/unknown state and new foodpanda intake refuses it.
SELECT set_config('app.skip_revision', '1', true);
UPDATE bms_delivery_orders
   SET transport_type = sanitized_metadata->>'transportType'
 WHERE transport_type IS NULL
   AND sanitized_metadata->>'transportType' IN ('LOGISTICS_DELIVERY','VENDOR_DELIVERY');
SELECT set_config('app.skip_revision', '0', true);

ALTER TABLE bms_delivery_events
  ADD COLUMN IF NOT EXISTS provider_call_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bms_delivery_events
  DROP CONSTRAINT IF EXISTS bms_delivery_events_provider_call_attempts_check;
ALTER TABLE bms_delivery_events
  ADD CONSTRAINT bms_delivery_events_provider_call_attempts_check
  CHECK (provider_call_attempts >= 0);

ALTER TABLE bms_delivery_commands
  ADD COLUMN IF NOT EXISTS provider_call_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bms_delivery_commands
  DROP CONSTRAINT IF EXISTS bms_delivery_commands_provider_call_attempts_check;
ALTER TABLE bms_delivery_commands
  ADD CONSTRAINT bms_delivery_commands_provider_call_attempts_check
  CHECK (provider_call_attempts >= 0);

COMMENT ON COLUMN bms_delivery_integrations.config_version IS
  'Monotonic identity for credential/config snapshots; intake rechecks it under FOR UPDATE after provider fetch (10.14)';
COMMENT ON COLUMN bms_delivery_orders.transport_type IS
  'Typed provider transport authority. NULL is legacy/unknown and cannot authorize a foodpanda lifecycle command (10.14)';
COMMENT ON COLUMN bms_delivery_events.provider_call_attempts IS
  'Actual provider HTTP attempts, distinct from leased event processing attempts (10.14)';
COMMENT ON COLUMN bms_delivery_commands.provider_call_attempts IS
  'Actual provider HTTP attempts, distinct from local command claim attempts and idempotency (10.14)';

COMMIT;

-- ROLLBACK (safe before code depends on the typed authority/counters):
-- BEGIN;
-- ALTER TABLE bms_delivery_commands DROP COLUMN IF EXISTS provider_call_attempts;
-- ALTER TABLE bms_delivery_events DROP COLUMN IF EXISTS provider_call_attempts;
-- ALTER TABLE bms_delivery_orders DROP COLUMN IF EXISTS transport_type;
-- ALTER TABLE bms_delivery_integrations DROP COLUMN IF EXISTS config_version;
-- COMMIT;
