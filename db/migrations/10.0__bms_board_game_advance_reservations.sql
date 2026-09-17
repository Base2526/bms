-- =============================================================
-- 10.0  Board-game advance reservations
-- -------------------------------------------------------------
-- A reservation and a walk-in queue row are both parties without a session. They share the same
-- seating path, but a reservation owns a future table/time window while a walk-in owns a queue
-- number immediately. Check-in converts the reservation into today's live queue without creating
-- a second clock, bill, stock reservation, or POS settlement path.
--
-- Table-window conflicts are serialized and checked by the service under a per-table advisory lock.
-- `reserved_for` is a promise made by staff; `expected_end_at` on a live session remains an estimate.
--
-- ROLLBACK (only before reservation rows exist):
--   DROP INDEX IF EXISTS idx_bms_board_game_waitlist_reservations;
--   ALTER TABLE bms_board_game_waitlist DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_reserved_table_fk;
--   ALTER TABLE bms_board_game_waitlist DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_kind_shape;
--   ALTER TABLE bms_board_game_waitlist DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_status_check;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS checked_in_at;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS confirmed_at;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS reserved_table_id;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS reserved_duration_minutes;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS reserved_for;
--   ALTER TABLE bms_board_game_waitlist DROP COLUMN IF EXISTS kind;
--   ALTER TABLE bms_board_game_waitlist ALTER COLUMN queue_no SET NOT NULL;
--   ALTER TABLE bms_board_game_waitlist ADD CONSTRAINT bms_board_game_waitlist_status_check
--     CHECK (status IN ('WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'));
-- =============================================================

BEGIN;

ALTER TABLE bms_board_game_waitlist
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'WALK_IN',
  ADD COLUMN IF NOT EXISTS reserved_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS reserved_table_id UUID,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

ALTER TABLE bms_board_game_waitlist ALTER COLUMN queue_no DROP NOT NULL;

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_status_check;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_status_check CHECK (status IN (
    'CONFIRMED', 'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'
  ));

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_kind_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_kind_shape CHECK (
    (
      kind = 'WALK_IN'
      AND queue_no IS NOT NULL
      AND reserved_for IS NULL
      AND reserved_duration_minutes IS NULL
      AND reserved_table_id IS NULL
      AND confirmed_at IS NULL
      AND checked_in_at IS NULL
      AND status <> 'CONFIRMED'
    )
    OR
    (
      kind = 'RESERVATION'
      AND reserved_for IS NOT NULL
      AND reserved_duration_minutes BETWEEN 30 AND 720
      AND reserved_table_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND ((queue_no IS NULL) = (checked_in_at IS NULL))
      AND (status NOT IN ('WAITING', 'CALLED') OR queue_no IS NOT NULL)
      AND (
        (status = 'CONFIRMED' AND queue_no IS NULL AND checked_in_at IS NULL)
        OR status IN ('WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW')
      )
    )
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_reserved_table_fk;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_reserved_table_fk
  FOREIGN KEY (tenant_id, location_id, reserved_table_id)
  REFERENCES bms_board_game_tables(tenant_id, location_id, id);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_reservations
  ON bms_board_game_waitlist (tenant_id, location_id, reserved_table_id, reserved_for)
  WHERE kind = 'RESERVATION' AND status IN ('CONFIRMED', 'WAITING', 'CALLED');

COMMENT ON COLUMN bms_board_game_waitlist.kind IS
  'WALK_IN receives a service-day queue number immediately; RESERVATION owns a future table window.';
COMMENT ON COLUMN bms_board_game_waitlist.reserved_for IS
  'Confirmed appointment instant. It is not a live-session expected_end_at estimate.';
COMMENT ON COLUMN bms_board_game_waitlist.reserved_table_id IS
  'Table promised for conflict detection. Staff may seat at another capacity-safe table when reality changes.';

COMMIT;
