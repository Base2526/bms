-- 10.117 Customer chat may quote only explicitly published pass plans and offers.
-- Existing rows remain private until an operator opts in per row.
BEGIN;

ALTER TABLE bms_board_game_pass_plans
  ADD COLUMN IF NOT EXISTS publish_to_chat BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bms_board_game_offers
  ADD COLUMN IF NOT EXISTS publish_to_chat BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_board_game_pass_plans.publish_to_chat IS
  'Operator opt-in to expose an active plan name, price and duration in customer chat. Defaults off for existing plans.';
COMMENT ON COLUMN bms_board_game_offers.publish_to_chat IS
  'Operator opt-in to expose an active offer and its stated conditions in customer chat. Defaults off for existing offers.';

COMMIT;

-- ROLLBACK: Disable publication first, then remove the two columns if no deployed reader uses them.
-- UPDATE bms_board_game_pass_plans SET publish_to_chat = FALSE;
-- UPDATE bms_board_game_offers SET publish_to_chat = FALSE;
-- ALTER TABLE bms_board_game_pass_plans DROP COLUMN IF EXISTS publish_to_chat;
-- ALTER TABLE bms_board_game_offers DROP COLUMN IF EXISTS publish_to_chat;
