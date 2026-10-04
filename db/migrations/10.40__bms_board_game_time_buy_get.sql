BEGIN;

ALTER TABLE bms_board_game_offers ADD COLUMN IF NOT EXISTS buy_minutes INTEGER;
ALTER TABLE bms_board_game_offers ADD COLUMN IF NOT EXISTS free_minutes INTEGER;
ALTER TABLE bms_board_game_offers DROP CONSTRAINT IF EXISTS bms_board_game_offers_kind_check;
ALTER TABLE bms_board_game_offers ADD CONSTRAINT bms_board_game_offers_kind_check
  CHECK (kind IN ('TIME_PERCENT','TIME_FIXED_PER_PERSON','GROUP_FIXED','TIME_BUY_GET'));
ALTER TABLE bms_board_game_offers DROP CONSTRAINT IF EXISTS bms_board_game_offers_value_shape;
ALTER TABLE bms_board_game_offers ADD CONSTRAINT bms_board_game_offers_value_shape CHECK (
  (kind = 'TIME_PERCENT' AND percent_off IS NOT NULL AND percent_off > 0 AND percent_off <= 100
    AND fixed_price IS NULL AND buy_minutes IS NULL AND free_minutes IS NULL)
  OR (kind IN ('TIME_FIXED_PER_PERSON','GROUP_FIXED') AND fixed_price IS NOT NULL AND fixed_price >= 0
    AND percent_off IS NULL AND buy_minutes IS NULL AND free_minutes IS NULL)
  OR (kind = 'TIME_BUY_GET' AND percent_off IS NULL AND fixed_price IS NULL
    AND buy_minutes IS NOT NULL AND buy_minutes BETWEEN 1 AND 1440
    AND free_minutes IS NOT NULL AND free_minutes BETWEEN 1 AND 1440)
);

COMMENT ON COLUMN bms_board_game_offers.buy_minutes IS 'Per-player paid minutes in each repeating paid/free cycle, after normal billing-time rounding.';
COMMENT ON COLUMN bms_board_game_offers.free_minutes IS 'Per-player free minutes following the paid minutes in each repeating cycle.';

COMMIT;
