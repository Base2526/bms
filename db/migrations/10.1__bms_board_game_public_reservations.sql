-- =============================================================
-- 10.1  Public board-game reservation requests and reminders
-- -------------------------------------------------------------
-- A public request is deliberately not a confirmed booking. It owns no table until staff reviews
-- it under the same table lock and overlap checks used by staff-created reservations. The opaque
-- manage token is stored only as a hash. Reminder delivery is a retryable projection of a confirmed
-- reservation; it is not authority for the booking itself.
--
-- Reservation deposits are intentionally absent. bms_payments requires an order and the existing
-- POS deposit aggregate reserves sellable stock. A table request must not be disguised as either.
-- =============================================================

BEGIN;

ALTER TABLE bms_board_game_public_locations
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reservation_reminder_minutes INTEGER NOT NULL DEFAULT 180;

ALTER TABLE bms_board_game_public_locations
  DROP CONSTRAINT IF EXISTS bms_board_game_public_locations_reminder_minutes_check;
ALTER TABLE bms_board_game_public_locations
  ADD CONSTRAINT bms_board_game_public_locations_reminder_minutes_check
  CHECK (reservation_reminder_minutes BETWEEN 30 AND 10080);

ALTER TABLE bms_board_game_waitlist
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS guest_email TEXT,
  ADD COLUMN IF NOT EXISTS public_manage_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS public_request_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS public_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS reminder_minutes_before INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_status TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS reminder_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_error TEXT;

ALTER TABLE bms_board_game_waitlist ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_closed_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_closed_shape CHECK (
    (status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'REJECTED')) = (closed_at IS NOT NULL)
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_status_check;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_status_check CHECK (status IN (
    'REQUESTED', 'CONFIRMED', 'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'REJECTED'
  ));

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_kind_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_kind_shape CHECK (
    (
      kind = 'WALK_IN'
      AND source = 'STAFF'
      AND created_by IS NOT NULL
      AND queue_no IS NOT NULL
      AND reserved_for IS NULL
      AND reserved_duration_minutes IS NULL
      AND reserved_table_id IS NULL
      AND confirmed_at IS NULL
      AND checked_in_at IS NULL
      AND status NOT IN ('REQUESTED', 'CONFIRMED', 'REJECTED')
    )
    OR
    (
      kind = 'RESERVATION'
      AND reserved_for IS NOT NULL
      AND reserved_duration_minutes BETWEEN 30 AND 720
      AND ((queue_no IS NULL) = (checked_in_at IS NULL))
      AND (status NOT IN ('WAITING', 'CALLED') OR queue_no IS NOT NULL)
      AND (
        (status = 'REQUESTED' AND source = 'PUBLIC' AND reserved_table_id IS NULL
          AND confirmed_at IS NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('REJECTED', 'CANCELLED') AND source = 'PUBLIC' AND reserved_table_id IS NULL
          AND confirmed_at IS NULL AND closed_at IS NOT NULL)
        OR
        (status = 'CONFIRMED' AND reserved_table_id IS NOT NULL
          AND confirmed_at IS NOT NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW')
          AND reserved_table_id IS NOT NULL AND confirmed_at IS NOT NULL)
      )
    )
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_public_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_public_shape CHECK (
    (source = 'STAFF' AND created_by IS NOT NULL
      AND public_manage_token_hash IS NULL AND public_request_key_hash IS NULL
      AND public_request_hash IS NULL)
    OR
    (source = 'PUBLIC' AND kind = 'RESERVATION' AND created_by IS NULL
      AND public_manage_token_hash IS NOT NULL AND public_request_key_hash IS NOT NULL
      AND public_request_hash IS NOT NULL
      AND guest_email IS NOT NULL)
  );

ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_public_text_check;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_public_text_check CHECK (
    source IN ('STAFF', 'PUBLIC')
    AND (guest_email IS NULL OR length(btrim(guest_email)) BETWEEN 3 AND 254)
    AND (public_manage_token_hash IS NULL OR length(public_manage_token_hash) = 64)
    AND (public_request_key_hash IS NULL OR length(public_request_key_hash) = 64)
    AND (public_request_hash IS NULL OR length(public_request_hash) = 64)
    AND (rejection_reason IS NULL OR length(rejection_reason) <= 300)
    AND (reminder_minutes_before IS NULL OR reminder_minutes_before BETWEEN 30 AND 10080)
    AND reminder_status IN ('NONE', 'PENDING', 'SENDING', 'SENT', 'FAILED')
    AND reminder_attempts BETWEEN 0 AND 20
    AND (reminder_error IS NULL OR length(reminder_error) <= 500)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_waitlist_public_token
  ON bms_board_game_waitlist (public_manage_token_hash)
  WHERE public_manage_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_waitlist_public_request
  ON bms_board_game_waitlist (tenant_id, location_id, public_request_key_hash)
  WHERE public_request_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_public_review
  ON bms_board_game_waitlist (tenant_id, location_id, reserved_for, created_at)
  WHERE kind = 'RESERVATION' AND status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_reminders_due
  ON bms_board_game_waitlist (reserved_for)
  WHERE kind = 'RESERVATION' AND status = 'CONFIRMED'
    AND reminder_status IN ('PENDING', 'FAILED');

COMMENT ON COLUMN bms_board_game_waitlist.public_manage_token_hash IS
  'SHA-256 of the opaque customer manage token. The raw token is returned once and never stored.';
COMMENT ON COLUMN bms_board_game_waitlist.reminder_status IS
  'Operational email projection only; reservation status remains authoritative.';

COMMIT;

-- ROLLBACK (only before public requests exist): drop the indexes/constraints/columns added above,
-- restore created_by NOT NULL, then restore the status and kind constraints from migration 10.0.
