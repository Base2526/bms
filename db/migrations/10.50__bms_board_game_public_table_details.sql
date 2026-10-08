-- =============================================================
-- 10.50  Opt-in customer-safe board-game table details
-- -------------------------------------------------------------
-- Area labels and capacity bands are useful public facts, but existing
-- branches only opted into aggregate availability. Keep the new projection
-- off until the shop explicitly enables it.
-- =============================================================

BEGIN;

ALTER TABLE bms_board_game_public_locations
  ADD COLUMN IF NOT EXISTS publish_table_details BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_board_game_public_locations.publish_table_details IS
  'Opt-in publication of active area labels and capacity-grouped table counts; never table ids, codes, sessions or customer data.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_board_game_public_locations DROP COLUMN IF EXISTS publish_table_details;
