-- =============================================================
-- 9.98  Board-game guest service-call branch-chain hardening
-- -------------------------------------------------------------
-- 9.96 copied location/session/token/table identifiers onto the operational call row for fast
-- branch reads, but its FKs proved only tenant ownership one pair at a time.  A future writer could
-- therefore combine a session, token, or table from different branches inside the same tenant and
-- still satisfy every original constraint.  Additive constraints are in a new migration so a
-- database that already applied 9.96 receives the repair too.
-- =============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_guest_tokens_scope
  ON bms_board_game_guest_tokens (tenant_id, location_id, session_id, id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_guest_tokens'::regclass
       AND conname = 'bms_board_game_guest_tokens_location_scope_fkey'
  ) THEN
    ALTER TABLE bms_board_game_guest_tokens
      ADD CONSTRAINT bms_board_game_guest_tokens_location_scope_fkey
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_guest_tokens'::regclass
       AND conname = 'bms_board_game_guest_tokens_session_scope_fkey'
  ) THEN
    ALTER TABLE bms_board_game_guest_tokens
      ADD CONSTRAINT bms_board_game_guest_tokens_session_scope_fkey
      FOREIGN KEY (tenant_id, location_id, session_id)
      REFERENCES bms_board_game_sessions(tenant_id, location_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_service_calls'::regclass
       AND conname = 'bms_board_game_service_calls_session_scope_fkey'
  ) THEN
    ALTER TABLE bms_board_game_service_calls
      ADD CONSTRAINT bms_board_game_service_calls_session_scope_fkey
      FOREIGN KEY (tenant_id, location_id, session_id)
      REFERENCES bms_board_game_sessions(tenant_id, location_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_service_calls'::regclass
       AND conname = 'bms_board_game_service_calls_guest_scope_fkey'
  ) THEN
    ALTER TABLE bms_board_game_service_calls
      ADD CONSTRAINT bms_board_game_service_calls_guest_scope_fkey
      FOREIGN KEY (tenant_id, location_id, session_id, guest_token_id)
      REFERENCES bms_board_game_guest_tokens(tenant_id, location_id, session_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_service_calls'::regclass
       AND conname = 'bms_board_game_service_calls_table_scope_fkey'
  ) THEN
    ALTER TABLE bms_board_game_service_calls
      ADD CONSTRAINT bms_board_game_service_calls_table_scope_fkey
      FOREIGN KEY (tenant_id, location_id, table_id_at_request)
      REFERENCES bms_board_game_tables(tenant_id, location_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_guest_tokens
  VALIDATE CONSTRAINT bms_board_game_guest_tokens_location_scope_fkey;
ALTER TABLE bms_board_game_guest_tokens
  VALIDATE CONSTRAINT bms_board_game_guest_tokens_session_scope_fkey;
ALTER TABLE bms_board_game_service_calls
  VALIDATE CONSTRAINT bms_board_game_service_calls_session_scope_fkey;
ALTER TABLE bms_board_game_service_calls
  VALIDATE CONSTRAINT bms_board_game_service_calls_guest_scope_fkey;
ALTER TABLE bms_board_game_service_calls
  VALIDATE CONSTRAINT bms_board_game_service_calls_table_scope_fkey;

COMMIT;
