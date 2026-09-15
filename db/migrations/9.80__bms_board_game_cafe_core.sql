-- =============================================================
-- 9.80  Board game cafe core domain
-- -------------------------------------------------------------
-- Board-game cafes keep service state separate from normal POS carts:
-- time-based play sessions are calculated by this domain, sellable goods stay
-- Products/Inventory, and playable board games are asset copies in a library.
-- Final payment must still flow through the existing POS/payment path.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (tenant_id, location_id, name),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_board_game_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  area_id     UUID NOT NULL,
  code        TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 30),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  seats       INTEGER NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 100),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  blocked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (tenant_id, location_id, code),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, area_id)
    REFERENCES bms_board_game_areas(tenant_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_board_game_time_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,40}$'),
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  customer_type   TEXT NOT NULL DEFAULT 'GENERAL' CHECK (customer_type IN (
    'GENERAL', 'STUDENT', 'MEMBER', 'CHILD', 'CUSTOM'
  )),
  price_per_hour  NUMERIC(12,2) NOT NULL CHECK (price_per_hour >= 0),
  minimum_minutes INTEGER NOT NULL DEFAULT 60 CHECK (minimum_minutes BETWEEN 0 AND 1440),
  rounding_minutes INTEGER NOT NULL DEFAULT 30 CHECK (rounding_minutes BETWEEN 1 AND 1440),
  grace_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 240),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS bms_board_game_sessions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id                UUID NOT NULL,
  table_id                   UUID NOT NULL,
  pos_device_id              UUID,
  pos_shift_id               UUID,
  status                     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'CLOSING', 'PAID', 'CANCELLED'
  )),
  billing_mode               TEXT NOT NULL DEFAULT 'OPEN_ENDED' CHECK (billing_mode IN (
    'OPEN_ENDED', 'FIXED_DURATION'
  )),
  guest_count                INTEGER NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 0 AND 500),
  expected_duration_minutes  INTEGER CHECK (expected_duration_minutes IS NULL OR expected_duration_minutes BETWEEN 1 AND 1440),
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_end_at            TIMESTAMPTZ,
  ended_at                   TIMESTAMPTZ,
  alert_before_minutes       INTEGER NOT NULL DEFAULT 15 CHECK (alert_before_minutes BETWEEN 0 AND 120),
  note                       TEXT CHECK (note IS NULL OR length(note) <= 500),
  opened_by                  UUID REFERENCES users(id),
  closed_by                  UUID REFERENCES users(id),
  current_order_id           UUID,
  open_idempotency_key       TEXT NOT NULL CHECK (length(open_idempotency_key) BETWEEN 8 AND 200),
  open_request_hash          TEXT NOT NULL,
  settlement_idempotency_key TEXT,
  settlement_request_hash    TEXT,
  cancel_idempotency_key     TEXT,
  cancel_request_hash        TEXT,
  charge_snapshot            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(charge_snapshot) = 'array'),
  amount_due                 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  version                    INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, table_id)
    REFERENCES bms_board_game_tables(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, pos_device_id)
    REFERENCES bms_pos_devices(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, pos_device_id, pos_shift_id)
    REFERENCES bms_pos_shifts(tenant_id, location_id, device_id, id),
  FOREIGN KEY (tenant_id, current_order_id)
    REFERENCES bms_orders(tenant_id, id),
  CHECK ((status = 'OPEN') = (ended_at IS NULL)),
  CHECK (
    (billing_mode = 'FIXED_DURATION') =
    (expected_duration_minutes IS NOT NULL AND expected_end_at IS NOT NULL)
  ),
  CHECK (
    expected_end_at IS NULL OR
    expected_end_at = started_at + expected_duration_minutes * INTERVAL '1 minute'
  ),
  CHECK ((pos_device_id IS NULL) = (pos_shift_id IS NULL)),
  CHECK (
    status NOT IN ('CLOSING', 'PAID') OR
    (settlement_idempotency_key IS NOT NULL AND settlement_request_hash IS NOT NULL)
  ),
  CHECK (
    status <> 'CANCELLED' OR
    (cancel_idempotency_key IS NOT NULL AND cancel_request_hash IS NOT NULL)
  ),
  CHECK (status <> 'PAID' OR current_order_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_open_table
  ON bms_board_game_sessions (tenant_id, table_id)
  WHERE table_id IS NOT NULL AND status IN ('OPEN', 'CLOSING');
CREATE INDEX IF NOT EXISTS idx_bms_board_game_sessions_location_open
  ON bms_board_game_sessions (tenant_id, location_id, started_at DESC)
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

CREATE TABLE IF NOT EXISTS bms_board_game_session_participants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  session_id           UUID NOT NULL,
  rate_id              UUID,
  customer_id          UUID,
  display_name         TEXT CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 100),
  participant_type     TEXT NOT NULL DEFAULT 'GENERAL' CHECK (participant_type IN (
    'GENERAL', 'STUDENT', 'MEMBER', 'CHILD', 'GUARDIAN', 'OBSERVER', 'FOOD_ONLY', 'CUSTOM'
  )),
  billable             BOOLEAN NOT NULL DEFAULT TRUE,
  hourly_rate_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (hourly_rate_snapshot >= 0),
  minimum_minutes_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (minimum_minutes_snapshot BETWEEN 0 AND 1440),
  rounding_minutes_snapshot INTEGER NOT NULL DEFAULT 30 CHECK (rounding_minutes_snapshot BETWEEN 1 AND 1440),
  grace_minutes_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes_snapshot BETWEEN 0 AND 240),
  billing_group_no     INTEGER NOT NULL DEFAULT 1 CHECK (billing_group_no BETWEEN 1 AND 20),
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, rate_id)
    REFERENCES bms_board_game_time_rates(tenant_id, id),
  CHECK (left_at IS NULL OR left_at >= joined_at),
  CHECK ((billable AND rate_id IS NOT NULL) OR (NOT billable AND hourly_rate_snapshot = 0))
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_participants_session
  ON bms_board_game_session_participants (tenant_id, session_id, billing_group_no, created_at);

CREATE TABLE IF NOT EXISTS bms_board_game_titles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  title                TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  min_players          INTEGER CHECK (min_players IS NULL OR min_players BETWEEN 1 AND 100),
  max_players          INTEGER CHECK (max_players IS NULL OR max_players BETWEEN 1 AND 100),
  typical_minutes      INTEGER CHECK (typical_minutes IS NULL OR typical_minutes BETWEEN 1 AND 1440),
  difficulty           TEXT CHECK (difficulty IS NULL OR difficulty IN ('LIGHT', 'MEDIUM', 'HEAVY', 'CUSTOM')),
  language             TEXT CHECK (language IS NULL OR length(language) <= 80),
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  public_visible       BOOLEAN NOT NULL DEFAULT FALSE,
  linked_product_sku   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, title),
  FOREIGN KEY (tenant_id, linked_product_sku)
    REFERENCES bms_products(tenant_id, sku),
  CHECK (max_players IS NULL OR min_players IS NULL OR max_players >= min_players)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_purchase_orders_tenant_id
  ON bms_purchase_orders (tenant_id, id);

CREATE TABLE IF NOT EXISTS bms_board_game_copies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  title_id          UUID NOT NULL,
  location_id       UUID NOT NULL,
  copy_code         TEXT NOT NULL CHECK (length(btrim(copy_code)) BETWEEN 1 AND 50),
  status            TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN (
    'AVAILABLE', 'IN_USE', 'NEEDS_CHECK', 'DAMAGED', 'MISSING_PARTS',
    'REPAIRING', 'RETIRED', 'LOST'
  )),
  condition_note    TEXT CHECK (condition_note IS NULL OR length(condition_note) <= 500),
  purchase_order_id UUID,
  purchase_cost     NUMERIC(12,2) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
  acquired_at       TIMESTAMPTZ,
  retired_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, copy_code),
  FOREIGN KEY (tenant_id, title_id)
    REFERENCES bms_board_game_titles(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES bms_purchase_orders(tenant_id, id),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_copies_title
  ON bms_board_game_copies (tenant_id, title_id, status);
CREATE INDEX IF NOT EXISTS idx_bms_board_game_copies_location
  ON bms_board_game_copies (tenant_id, location_id, status);

CREATE TABLE IF NOT EXISTS bms_board_game_session_games (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL,
  copy_id         UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'CHECKED_OUT' CHECK (status IN ('CHECKED_OUT', 'RETURNED', 'ISSUE')),
  checked_out_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at     TIMESTAMPTZ,
  return_note     TEXT CHECK (return_note IS NULL OR length(return_note) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, copy_id)
    REFERENCES bms_board_game_copies(tenant_id, id),
  CHECK ((status = 'CHECKED_OUT') = (returned_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_copy_open_loan
  ON bms_board_game_session_games (tenant_id, copy_id)
  WHERE status = 'CHECKED_OUT';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_session_games_session
  ON bms_board_game_session_games (tenant_id, session_id, checked_out_at);

CREATE TABLE IF NOT EXISTS bms_board_game_idempotency_results (
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  action         TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash   TEXT NOT NULL,
  result         JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, action, idempotency_key)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_board_game_areas', 'bms_board_game_tables', 'bms_board_game_time_rates',
    'bms_board_game_sessions', 'bms_board_game_session_participants',
    'bms_board_game_titles', 'bms_board_game_copies', 'bms_board_game_session_games',
    'bms_board_game_idempotency_results'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_board_game_areas, bms_board_game_tables, bms_board_game_time_rates,
  bms_board_game_sessions, bms_board_game_session_participants,
  bms_board_game_titles, bms_board_game_copies, bms_board_game_session_games,
  bms_board_game_idempotency_results
  TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_areas');
SELECT public.create_revision_trigger('bms_board_game_tables');
SELECT public.create_revision_trigger('bms_board_game_time_rates');
SELECT public.create_revision_trigger('bms_board_game_sessions');
SELECT public.create_revision_trigger('bms_board_game_session_participants');
SELECT public.create_revision_trigger('bms_board_game_titles');
SELECT public.create_revision_trigger('bms_board_game_copies');
SELECT public.create_revision_trigger('bms_board_game_session_games');

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'board_game.session.manage'),
  ('Manager', 'board_game.session.override_time'),
  ('Manager', 'board_game.session.cancel'),
  ('Manager', 'board_game.floor.manage'),
  ('Manager', 'board_game.rate.manage'),
  ('Manager', 'board_game.library.view'),
  ('Manager', 'board_game.library.manage'),
  ('Manager', 'board_game.reports.view'),
  ('Sales',   'board_game.session.manage'),
  ('Sales',   'board_game.library.view'),
  ('Cashier', 'board_game.session.manage'),
  ('Cashier', 'board_game.library.view')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_board_game_sessions IS
  'Timed play session for a board-game cafe. Final settlement must flow through the existing POS order/payment path.';
COMMENT ON TABLE bms_board_game_time_rates IS
  'Board-game hourly billing rules. These are not products and are never sold by typing a SKU.';
COMMENT ON TABLE bms_board_game_copies IS
  'Physical playable board-game copies. They are assets, not sellable inventory stock.';

COMMIT;

-- ROLLBACK:
-- DROP TABLE IF EXISTS bms_board_game_idempotency_results;
-- DROP TABLE IF EXISTS bms_board_game_session_games;
-- DROP TABLE IF EXISTS bms_board_game_copies;
-- DROP TABLE IF EXISTS bms_board_game_titles;
-- DROP TABLE IF EXISTS bms_board_game_session_participants;
-- DROP TABLE IF EXISTS bms_board_game_sessions;
-- DROP TABLE IF EXISTS bms_board_game_time_rates;
-- DROP TABLE IF EXISTS bms_board_game_tables;
-- DROP TABLE IF EXISTS bms_board_game_areas;
