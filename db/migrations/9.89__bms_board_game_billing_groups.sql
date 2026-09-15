-- =============================================================
-- 9.89  Board-game billing groups: a bill belongs to a tab, not to a table
-- -------------------------------------------------------------
-- `9.80` made the *table session* the unit that owns money: it carried the
-- settlement keys, the frozen `charge_snapshot`, the `amount_due` and the one
-- `current_order_id` that `9.82` then claimed as unique per session.  Splitting
-- a table was therefore impossible by construction -- `billing_group_no` existed
-- on a participant and reached the charge lines, but every group still settled
-- inside one order, so "this group pays and leaves now" had nowhere to be
-- recorded.
--
-- This migration extracts the tab.  `bms_board_game_billing_groups` owns the
-- money; the session keeps seating and timing.  Nothing about today's default
-- changes: a table opened with one billing group still produces exactly one
-- bill, because one group is created for it.
--
-- Why the session's money columns are kept but no longer written:
--   * they hold the history of everything settled before this migration, and
--     dropping them is not reversible;
--   * a column that *some* code still writes is how two sources of truth start,
--     so the service stops writing them entirely and the CHECKs that forced
--     money onto the session are relaxed instead of being satisfied by a mirror.
--
-- Why the order points at BOTH the group and the session:
--   * the group is what the order settles, and the active-order claim must live
--     there or the second group of a table can never be settled at all;
--   * the session stays on the row because "which table visit did this bill come
--     from" is a reporting question that outlives the tab.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. The tab
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bms_board_game_billing_groups (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id                UUID NOT NULL,
  session_id                 UUID NOT NULL,
  -- Staff-facing number of the group inside its table ("กลุ่ม 2").  It is scoped
  -- to the session, not global, because that is how the counter says it out loud.
  group_no                   INTEGER NOT NULL CHECK (group_no BETWEEN 1 AND 20),
  status                     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'CLOSING', 'PAID', 'CANCELLED'
  )),
  amount_due                 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  charge_snapshot            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(charge_snapshot) = 'array'),
  current_order_id           UUID,
  ended_at                   TIMESTAMPTZ,
  closed_by                  UUID REFERENCES users(id),
  settlement_idempotency_key TEXT,
  settlement_request_hash    TEXT,
  cancel_idempotency_key     TEXT,
  cancel_request_hash        TEXT,
  cancel_reason              TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  version                    INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (tenant_id, session_id, group_no),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, current_order_id)
    REFERENCES bms_orders(tenant_id, location_id, id),
  CONSTRAINT bms_board_game_groups_ended_at_shape
    CHECK ((status = 'OPEN') = (ended_at IS NULL)),
  CONSTRAINT bms_board_game_groups_settlement_shape
    CHECK (
      status NOT IN ('CLOSING', 'PAID') OR
      (settlement_idempotency_key IS NOT NULL AND settlement_request_hash IS NOT NULL)
    ),
  CONSTRAINT bms_board_game_groups_cancel_shape
    CHECK (
      status <> 'CANCELLED' OR
      (cancel_idempotency_key IS NOT NULL AND cancel_request_hash IS NOT NULL)
    ),
  CONSTRAINT bms_board_game_groups_paid_order_shape
    CHECK (status <> 'PAID' OR current_order_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_groups_settlement_request
  ON bms_board_game_billing_groups (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_groups_cancel_request
  ON bms_board_game_billing_groups (tenant_id, cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_groups_order
  ON bms_board_game_billing_groups (tenant_id, current_order_id)
  WHERE current_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_board_game_groups_session
  ON bms_board_game_billing_groups (tenant_id, session_id, group_no);
CREATE INDEX IF NOT EXISTS idx_bms_board_game_groups_open
  ON bms_board_game_billing_groups (tenant_id, location_id, status)
  WHERE status IN ('OPEN', 'CLOSING');

-- -------------------------------------------------------------
-- 2. A participant belongs to a tab
-- -------------------------------------------------------------

ALTER TABLE bms_board_game_session_participants
  ADD COLUMN IF NOT EXISTS billing_group_id UUID;

-- -------------------------------------------------------------
-- 3. Backfill: exactly one group per existing session
-- -------------------------------------------------------------
-- One group per session is the truthful shape for history, not a simplification:
-- before this migration every session settled through a single order, so a
-- session that mixed two `billing_group_no` values still produced one bill.
-- Splitting those rows into two groups now would invent two bills that never
-- existed.  The per-line `billingGroupNo` stays inside `charge_snapshot`, which
-- is where the split was actually recorded.

INSERT INTO bms_board_game_billing_groups (
  tenant_id, location_id, session_id, group_no, status, amount_due, charge_snapshot,
  current_order_id, ended_at, closed_by, settlement_idempotency_key, settlement_request_hash,
  cancel_idempotency_key, cancel_request_hash, version, created_at, updated_at
)
SELECT s.tenant_id, s.location_id, s.id, 1, s.status, s.amount_due, s.charge_snapshot,
       s.current_order_id, s.ended_at, s.closed_by,
       s.settlement_idempotency_key, s.settlement_request_hash,
       s.cancel_idempotency_key, s.cancel_request_hash,
       s.version, s.created_at, s.updated_at
  FROM bms_board_game_sessions s
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_board_game_billing_groups g
    WHERE g.tenant_id = s.tenant_id AND g.session_id = s.id
 );

UPDATE bms_board_game_session_participants p
   SET billing_group_id = g.id
  FROM bms_board_game_billing_groups g
 WHERE g.tenant_id = p.tenant_id
   AND g.session_id = p.session_id
   AND p.billing_group_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bms_board_game_session_participants WHERE billing_group_id IS NULL
  ) THEN
    ALTER TABLE bms_board_game_session_participants
      ALTER COLUMN billing_group_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_board_game_participants_billing_group_fk'
  ) THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_billing_group_fk
      FOREIGN KEY (tenant_id, billing_group_id)
      REFERENCES bms_board_game_billing_groups(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_session_participants
  VALIDATE CONSTRAINT bms_board_game_participants_billing_group_fk;

CREATE INDEX IF NOT EXISTS idx_bms_board_game_participants_group
  ON bms_board_game_session_participants (tenant_id, billing_group_id, created_at);

-- -------------------------------------------------------------
-- 4. An order settles a tab
-- -------------------------------------------------------------

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS board_game_billing_group_id UUID;

UPDATE bms_orders o
   SET board_game_billing_group_id = g.id
  FROM bms_board_game_billing_groups g
 WHERE g.tenant_id = o.tenant_id
   AND g.session_id = o.board_game_session_id
   AND o.board_game_session_id IS NOT NULL
   AND o.board_game_billing_group_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_orders'::regclass
       AND conname = 'bms_orders_board_game_billing_group_location_fk'
  ) THEN
    ALTER TABLE bms_orders
      ADD CONSTRAINT bms_orders_board_game_billing_group_location_fk
      FOREIGN KEY (tenant_id, location_id, board_game_billing_group_id)
      REFERENCES bms_board_game_billing_groups(tenant_id, location_id, id)
      NOT VALID;
  END IF;
  -- A tab always belongs to a table visit.  Without this an order could name a
  -- group while claiming no session, and the two columns would disagree about
  -- the same bill.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_orders'::regclass
       AND conname = 'bms_orders_board_game_group_needs_session_chk'
  ) THEN
    ALTER TABLE bms_orders
      ADD CONSTRAINT bms_orders_board_game_group_needs_session_chk
      CHECK (board_game_billing_group_id IS NULL OR board_game_session_id IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_orders
  VALIDATE CONSTRAINT bms_orders_board_game_billing_group_location_fk;
ALTER TABLE bms_orders
  VALIDATE CONSTRAINT bms_orders_board_game_group_needs_session_chk;

-- The active-bill claim moves from the session to the tab.  Keeping it on the
-- session is exactly what made a second group unsettleable, so this index is
-- replaced rather than added to.
DROP INDEX IF EXISTS uq_bms_orders_active_board_game_session;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_active_board_game_group
  ON bms_orders (tenant_id, board_game_billing_group_id)
  WHERE board_game_billing_group_id IS NOT NULL
    AND status IN ('PENDING', 'PAID', 'COMPLETED');

CREATE INDEX IF NOT EXISTS idx_bms_orders_board_game_group_history
  ON bms_orders (tenant_id, board_game_billing_group_id, created_at DESC)
  WHERE board_game_billing_group_id IS NOT NULL;

-- -------------------------------------------------------------
-- 5. The session stops owning money
-- -------------------------------------------------------------
-- These three CHECKs tie the session's status to settlement state that now
-- lives on the group.  A session reaching CLOSING/PAID/CANCELLED because all of
-- its groups did would violate every one of them.

DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'bms_board_game_sessions_settlement_shape',
    'bms_board_game_sessions_cancel_shape',
    'bms_board_game_sessions_paid_order_shape'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = target) THEN
      EXECUTE format('ALTER TABLE bms_board_game_sessions DROP CONSTRAINT %I', target);
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 6. Tenant isolation, grants, revisions
-- -------------------------------------------------------------

ALTER TABLE bms_board_game_billing_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_billing_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_billing_groups_tenant_isolation
  ON bms_board_game_billing_groups;
CREATE POLICY bms_board_game_billing_groups_tenant_isolation
  ON bms_board_game_billing_groups
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_billing_groups TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_billing_groups');

COMMENT ON TABLE bms_board_game_billing_groups IS
  'The unit a board-game bill settles. Owns the frozen charge snapshot, the amount due and the settling order; the session it belongs to owns seating and timing only.';
COMMENT ON COLUMN bms_board_game_billing_groups.group_no IS
  'Staff-facing group number inside one table visit. Unique per session, not per tenant.';
COMMENT ON COLUMN bms_orders.board_game_billing_group_id IS
  'Board-game tab settled by this order. The active-bill claim lives here, so one table visit can produce one bill per group.';
COMMENT ON COLUMN bms_board_game_sessions.amount_due IS
  'Legacy per-session total (<= 9.88). Superseded by bms_board_game_billing_groups.amount_due and no longer written.';
COMMENT ON COLUMN bms_board_game_sessions.charge_snapshot IS
  'Legacy per-session frozen charge lines (<= 9.88). Superseded by bms_board_game_billing_groups.charge_snapshot and no longer written.';
COMMENT ON COLUMN bms_board_game_sessions.current_order_id IS
  'Legacy single settling order (<= 9.88). Superseded by bms_board_game_billing_groups.current_order_id and no longer written.';

COMMIT;

-- ROLLBACK:
-- This migration moves live settlement state onto a new table and relaxes three
-- session CHECKs. Rolling it back after any group has been settled loses that
-- money trail, so restore from the pre-9.89 backup instead. Structural undo, for
-- a database where nothing has settled yet:
--   DROP INDEX IF EXISTS idx_bms_orders_board_game_group_history;
--   DROP INDEX IF EXISTS uq_bms_orders_active_board_game_group;
--   CREATE UNIQUE INDEX uq_bms_orders_active_board_game_session
--     ON bms_orders (tenant_id, board_game_session_id)
--     WHERE board_game_session_id IS NOT NULL
--       AND status IN ('PENDING', 'PAID', 'COMPLETED');
--   ALTER TABLE bms_orders DROP CONSTRAINT IF EXISTS bms_orders_board_game_group_needs_session_chk;
--   ALTER TABLE bms_orders DROP CONSTRAINT IF EXISTS bms_orders_board_game_billing_group_location_fk;
--   ALTER TABLE bms_orders DROP COLUMN IF EXISTS board_game_billing_group_id;
--   ALTER TABLE bms_board_game_session_participants
--     DROP CONSTRAINT IF EXISTS bms_board_game_participants_billing_group_fk;
--   ALTER TABLE bms_board_game_session_participants DROP COLUMN IF EXISTS billing_group_id;
--   DROP TABLE IF EXISTS bms_board_game_billing_groups;
