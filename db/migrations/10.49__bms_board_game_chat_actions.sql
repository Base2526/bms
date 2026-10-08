-- Opt-in authority for automatic, no-deposit chat reservations.
-- Rollback: deploy previous code, then drop chat_auto_confirm. Existing bookings remain valid.
BEGIN;
ALTER TABLE bms_board_game_public_locations
  ADD COLUMN IF NOT EXISTS chat_auto_confirm BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
