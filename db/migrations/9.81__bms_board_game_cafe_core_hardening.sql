-- =============================================================
-- 9.81  Board game cafe core hardening
-- -------------------------------------------------------------
-- Upgrades databases that received the first 9.80 draft before its contract
-- was hardened. New databases reach the same shape by running 9.80 then this
-- idempotent migration. Existing rows receive deterministic legacy request
-- keys and rate-rule snapshots so retries and later rate edits stay safe.
-- =============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_areas_tenant_location_id
  ON bms_board_game_areas (tenant_id, location_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_tables_tenant_location_id
  ON bms_board_game_tables (tenant_id, location_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_customers_tenant_id_id
  ON bms_customers (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_purchase_orders_tenant_id
  ON bms_purchase_orders (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_tenant_location_id
  ON bms_orders (tenant_id, location_id, id);

ALTER TABLE bms_board_game_sessions
  ADD COLUMN IF NOT EXISTS alert_before_minutes INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS open_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS open_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS settlement_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS cancel_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS cancel_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS charge_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE bms_board_game_sessions
   SET open_idempotency_key = COALESCE(open_idempotency_key, 'legacy-open:' || id::text),
       open_request_hash = COALESCE(open_request_hash, 'legacy:' || id::text),
       settlement_idempotency_key = CASE
         WHEN status IN ('CLOSING', 'PAID')
           THEN COALESCE(settlement_idempotency_key, 'legacy-close:' || id::text)
         ELSE settlement_idempotency_key
       END,
       settlement_request_hash = CASE
         WHEN status IN ('CLOSING', 'PAID')
           THEN COALESCE(settlement_request_hash, 'legacy:' || id::text)
         ELSE settlement_request_hash
       END,
       cancel_idempotency_key = CASE
         WHEN status = 'CANCELLED'
           THEN COALESCE(cancel_idempotency_key, 'legacy-cancel:' || id::text)
         ELSE cancel_idempotency_key
       END,
       cancel_request_hash = CASE
         WHEN status = 'CANCELLED'
           THEN COALESCE(cancel_request_hash, 'legacy:' || id::text)
         ELSE cancel_request_hash
       END,
       charge_snapshot = COALESCE(charge_snapshot, '[]'::jsonb);

ALTER TABLE bms_board_game_sessions
  ALTER COLUMN open_idempotency_key SET NOT NULL,
  ALTER COLUMN open_request_hash SET NOT NULL,
  ALTER COLUMN charge_snapshot SET NOT NULL;

ALTER TABLE bms_board_game_session_participants
  ADD COLUMN IF NOT EXISTS minimum_minutes_snapshot INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_minutes_snapshot INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS grace_minutes_snapshot INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_group_no INTEGER NOT NULL DEFAULT 1;

UPDATE bms_board_game_session_participants p
   SET minimum_minutes_snapshot = r.minimum_minutes,
       rounding_minutes_snapshot = r.rounding_minutes,
       grace_minutes_snapshot = r.grace_minutes
  FROM bms_board_game_time_rates r
 WHERE r.tenant_id = p.tenant_id
   AND r.id = p.rate_id
   AND p.minimum_minutes_snapshot = 0
   AND p.rounding_minutes_snapshot = 30
   AND p.grace_minutes_snapshot = 0;

-- The first service draft could create a zero-price billable participant with
-- no rate. It can never contribute money, so preserve it as a non-billable
-- attendee instead of inventing a historical rate.
UPDATE bms_board_game_session_participants
   SET billable = FALSE
 WHERE billable
   AND rate_id IS NULL
   AND hourly_rate_snapshot = 0;

DO $$
DECLARE target TEXT;
BEGIN
  -- Replace both the first-draft checks and 9.80's anonymous checks with one
  -- stable named contract per rule. CLOSING is the frozen billing state and
  -- therefore already has an ended_at timestamp.
  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%ended_at%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%alert_before_minutes%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'c'
       AND array_length(conkey, 1) = 1
       AND conkey[1] = (
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'bms_board_game_sessions'::regclass AND attname = 'guest_count'
       )
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%expected_end_at%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%open_idempotency_key%'
         OR pg_get_constraintdef(oid) ILIKE '%charge_snapshot%'
         OR pg_get_constraintdef(oid) ILIKE '%pos_device_id is null%pos_shift_id is null%'
         OR pg_get_constraintdef(oid) ILIKE '%settlement_idempotency_key%'
         OR pg_get_constraintdef(oid) ILIKE '%cancel_idempotency_key%'
         OR pg_get_constraintdef(oid) ILIKE '%status%paid%current_order_id%'
       )
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_session_participants'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%minimum_minutes_snapshot%'
         OR pg_get_constraintdef(oid) ILIKE '%rounding_minutes_snapshot%'
         OR pg_get_constraintdef(oid) ILIKE '%grace_minutes_snapshot%'
         OR pg_get_constraintdef(oid) ILIKE '%billing_group_no%'
         OR (
           pg_get_constraintdef(oid) ILIKE '%billable%'
           AND pg_get_constraintdef(oid) ILIKE '%rate_id%'
         )
       )
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_session_participants DROP CONSTRAINT %I', target);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_ended_at_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_ended_at_shape
      CHECK ((status = 'OPEN') = (ended_at IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_alert_before_range') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_alert_before_range
      CHECK (alert_before_minutes BETWEEN 0 AND 120) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_guest_count_range') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_guest_count_range
      CHECK (guest_count BETWEEN 0 AND 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_expected_time_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_expected_time_shape
      CHECK (
        (billing_mode = 'FIXED_DURATION') =
        (expected_duration_minutes IS NOT NULL AND expected_end_at IS NOT NULL)
        AND (
          expected_end_at IS NULL OR
          expected_end_at = started_at + expected_duration_minutes * INTERVAL '1 minute'
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_open_key_length') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_open_key_length
      CHECK (length(open_idempotency_key) BETWEEN 8 AND 200) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_charge_snapshot_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_charge_snapshot_shape
      CHECK (jsonb_typeof(charge_snapshot) = 'array') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_pos_scope_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_pos_scope_shape
      CHECK ((pos_device_id IS NULL) = (pos_shift_id IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_settlement_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_settlement_shape
      CHECK (
        status NOT IN ('CLOSING', 'PAID') OR
        (settlement_idempotency_key IS NOT NULL AND settlement_request_hash IS NOT NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_cancel_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_cancel_shape
      CHECK (
        status <> 'CANCELLED' OR
        (cancel_idempotency_key IS NOT NULL AND cancel_request_hash IS NOT NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_paid_order_shape') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_paid_order_shape
      CHECK (status <> 'PAID' OR current_order_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_rate_shape') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_rate_shape
      CHECK ((billable AND rate_id IS NOT NULL) OR (NOT billable AND hourly_rate_snapshot = 0)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_minimum_snapshot_range') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_minimum_snapshot_range
      CHECK (minimum_minutes_snapshot BETWEEN 0 AND 1440) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_rounding_snapshot_range') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_rounding_snapshot_range
      CHECK (rounding_minutes_snapshot BETWEEN 1 AND 1440) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_grace_snapshot_range') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_grace_snapshot_range
      CHECK (grace_minutes_snapshot BETWEEN 0 AND 240) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_billing_group_range') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_billing_group_range
      CHECK (billing_group_no BETWEEN 1 AND 20) NOT VALID;
  END IF;
END $$;

-- This update must run after the contradictory first-draft constraint is
-- removed. The newly-added NOT VALID constraint checks changed rows while
-- allowing the historical rows to be repaired before validation.
UPDATE bms_board_game_sessions
   SET ended_at = GREATEST(started_at, updated_at)
 WHERE status = 'CLOSING'
   AND ended_at IS NULL;

DO $$
DECLARE target TEXT;
BEGIN
  -- Composite keys are the branch/tenant boundary. Drop equivalent anonymous
  -- constraints first so fresh and upgraded databases converge on one shape.
  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_tables'::regclass
       AND contype = 'f'
       AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, location_id, area_id)%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_tables DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND contype = 'f'
       AND (
         pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, location_id, table_id)%'
         OR pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, location_id, pos_device_id)%'
         OR pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, location_id, pos_device_id, pos_shift_id)%'
         OR pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, location_id, current_order_id)%'
       )
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_session_participants'::regclass
       AND contype = 'f'
       AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, customer_id)%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_session_participants DROP CONSTRAINT %I', target);
  END LOOP;

  FOR target IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'bms_board_game_copies'::regclass
       AND contype = 'f'
       AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, purchase_order_id)%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_copies DROP CONSTRAINT %I', target);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_tables_area_location_fk') THEN
    ALTER TABLE bms_board_game_tables
      ADD CONSTRAINT bms_board_game_tables_area_location_fk
      FOREIGN KEY (tenant_id, location_id, area_id)
      REFERENCES bms_board_game_areas(tenant_id, location_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_table_location_fk') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_table_location_fk
      FOREIGN KEY (tenant_id, location_id, table_id)
      REFERENCES bms_board_game_tables(tenant_id, location_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_device_location_fk') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_device_location_fk
      FOREIGN KEY (tenant_id, location_id, pos_device_id)
      REFERENCES bms_pos_devices(tenant_id, location_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_shift_device_location_fk') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_shift_device_location_fk
      FOREIGN KEY (tenant_id, location_id, pos_device_id, pos_shift_id)
      REFERENCES bms_pos_shifts(tenant_id, location_id, device_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_sessions_order_location_fk') THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_order_location_fk
      FOREIGN KEY (tenant_id, location_id, current_order_id)
      REFERENCES bms_orders(tenant_id, location_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_customer_tenant_fk') THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_customer_tenant_fk
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES bms_customers(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_copies_purchase_order_tenant_fk') THEN
    ALTER TABLE bms_board_game_copies
      ADD CONSTRAINT bms_board_game_copies_purchase_order_tenant_fk
      FOREIGN KEY (tenant_id, purchase_order_id)
      REFERENCES bms_purchase_orders(tenant_id, id) NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_ended_at_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_alert_before_range;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_guest_count_range;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_expected_time_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_open_key_length;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_charge_snapshot_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_pos_scope_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_settlement_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_cancel_shape;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_paid_order_shape;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_rate_shape;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_minimum_snapshot_range;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_rounding_snapshot_range;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_grace_snapshot_range;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_billing_group_range;
ALTER TABLE bms_board_game_tables VALIDATE CONSTRAINT bms_board_game_tables_area_location_fk;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_table_location_fk;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_device_location_fk;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_shift_device_location_fk;
ALTER TABLE bms_board_game_sessions VALIDATE CONSTRAINT bms_board_game_sessions_order_location_fk;
ALTER TABLE bms_board_game_session_participants VALIDATE CONSTRAINT bms_board_game_participants_customer_tenant_fk;
ALTER TABLE bms_board_game_copies VALIDATE CONSTRAINT bms_board_game_copies_purchase_order_tenant_fk;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms_board_game_sessions WHERE table_id IS NULL) THEN
    ALTER TABLE bms_board_game_sessions ALTER COLUMN table_id SET NOT NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_bms_board_game_sessions_open_table;
CREATE UNIQUE INDEX uq_bms_board_game_sessions_open_table
  ON bms_board_game_sessions (tenant_id, table_id)
  WHERE status IN ('OPEN', 'CLOSING');
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_open_request
  ON bms_board_game_sessions (tenant_id, open_idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_settlement_request
  ON bms_board_game_sessions (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_cancel_request
  ON bms_board_game_sessions (tenant_id, cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_order
  ON bms_board_game_sessions (tenant_id, current_order_id)
  WHERE current_order_id IS NOT NULL;

DROP INDEX IF EXISTS idx_bms_board_game_participants_session;
CREATE INDEX idx_bms_board_game_participants_session
  ON bms_board_game_session_participants (tenant_id, session_id, billing_group_no, created_at);

CREATE TABLE IF NOT EXISTS bms_board_game_idempotency_results (
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash    TEXT NOT NULL,
  result          JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, action, idempotency_key)
);

ALTER TABLE bms_board_game_idempotency_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_idempotency_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_idempotency_results_tenant_isolation
  ON bms_board_game_idempotency_results;
CREATE POLICY bms_board_game_idempotency_results_tenant_isolation
  ON bms_board_game_idempotency_results
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_idempotency_results TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
  FROM bms_tenants t
 CROSS JOIN roles r
 JOIN (VALUES
   ('Manager', 'board_game.session.cancel'),
   ('Manager', 'board_game.library.view')
 ) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

ALTER TABLE bms_board_game_sessions DROP COLUMN IF EXISTS alert_status;

COMMIT;

-- ROLLBACK: this migration intentionally converts existing rows and adds
-- integrity constraints. Restore from the pre-9.81 database backup instead of
-- attempting a lossy structural rollback.
