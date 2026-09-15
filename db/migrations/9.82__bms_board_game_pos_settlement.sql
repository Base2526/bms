-- =============================================================
-- 9.82  Board game session settlement through the existing POS
-- -------------------------------------------------------------
-- A board-game session contributes server-derived service lines to a normal
-- POS order. The active-order uniqueness claim prevents two tills from
-- settling one session, while CANCELLED orders release that claim for retry.
-- =============================================================

BEGIN;

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS board_game_session_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_sessions_tenant_location_id
  ON bms_board_game_sessions (tenant_id, location_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_orders'::regclass
       AND conname = 'bms_orders_board_game_session_location_fk'
  ) THEN
    ALTER TABLE bms_orders
      ADD CONSTRAINT bms_orders_board_game_session_location_fk
      FOREIGN KEY (tenant_id, location_id, board_game_session_id)
      REFERENCES bms_board_game_sessions(tenant_id, location_id, id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_orders'::regclass
       AND conname = 'bms_orders_single_service_domain_chk'
  ) THEN
    ALTER TABLE bms_orders
      ADD CONSTRAINT bms_orders_single_service_domain_chk
      CHECK (restaurant_check_id IS NULL OR board_game_session_id IS NULL)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_orders
  VALIDATE CONSTRAINT bms_orders_board_game_session_location_fk;
ALTER TABLE bms_orders
  VALIDATE CONSTRAINT bms_orders_single_service_domain_chk;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_active_board_game_session
  ON bms_orders (tenant_id, board_game_session_id)
  WHERE board_game_session_id IS NOT NULL
    AND status IN ('PENDING', 'PAID', 'COMPLETED');

CREATE INDEX IF NOT EXISTS idx_bms_orders_board_game_session_history
  ON bms_orders (tenant_id, board_game_session_id, created_at DESC)
  WHERE board_game_session_id IS NOT NULL;

COMMENT ON COLUMN bms_orders.board_game_session_id IS
  'Server-validated board-game session settled by this normal POS order. Time lines are derived from the frozen session charge snapshot.';

COMMIT;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_bms_orders_board_game_session_history;
-- DROP INDEX IF EXISTS uq_bms_orders_active_board_game_session;
-- ALTER TABLE bms_orders DROP CONSTRAINT IF EXISTS bms_orders_single_service_domain_chk;
-- ALTER TABLE bms_orders DROP CONSTRAINT IF EXISTS bms_orders_board_game_session_location_fk;
-- ALTER TABLE bms_orders DROP COLUMN IF EXISTS board_game_session_id;
