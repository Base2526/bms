-- =============================================================
-- 10.7  Board-game flexible parties: capacity override, personal time,
--       bill-group merge, and detaching one group to another table
-- -------------------------------------------------------------
-- A billing group already owns the people and tab that pay together, but before
-- this migration it could neither be merged back into another open bill nor be
-- detached into its own visit/seating.  Purchased time also lived only on the
-- session, so a late player could not buy sixty minutes independently.
--
-- `planned_end_at` is a participant snapshot. NULL means charge actual time;
-- a value means charge at least through that instant even if the operator closes
-- early. Existing FIXED_DURATION visits are backfilled with the session end, so
-- their historical meaning does not change.
--
-- MERGED groups remain as history and point at the bill that absorbed them.
-- Active reads hide them; audit/revisions can still explain where the rows went.
-- =============================================================

BEGIN;

ALTER TABLE bms_board_game_session_participants
  ADD COLUMN IF NOT EXISTS time_mode TEXT NOT NULL DEFAULT 'ACTUAL',
  ADD COLUMN IF NOT EXISTS planned_end_at TIMESTAMPTZ;

-- Converge a partially applied development schema as well as a fresh install.
ALTER TABLE bms_board_game_session_participants
  ALTER COLUMN time_mode SET DEFAULT 'ACTUAL';

UPDATE bms_board_game_session_participants
   SET time_mode = 'ACTUAL'
 WHERE time_mode IS NULL;

ALTER TABLE bms_board_game_session_participants
  ALTER COLUMN time_mode SET NOT NULL;

UPDATE bms_board_game_session_participants p
   SET time_mode = CASE
         WHEN s.expected_end_at > p.joined_at THEN 'SESSION_END'
         ELSE 'ACTUAL'
       END,
       planned_end_at = CASE
         WHEN s.expected_end_at > p.joined_at THEN s.expected_end_at
         ELSE NULL
       END
  FROM bms_board_game_sessions s
 WHERE s.tenant_id = p.tenant_id
   AND s.id = p.session_id
   AND s.billing_mode = 'FIXED_DURATION'
   AND p.planned_end_at IS NULL
   AND p.time_mode = 'ACTUAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_session_participants'::regclass
       AND conname = 'bms_board_game_participants_time_mode_check'
  ) THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_time_mode_check
      CHECK (time_mode IN ('ACTUAL', 'SESSION_END', 'DURATION'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_session_participants'::regclass
       AND conname = 'bms_board_game_participants_planned_end_shape'
  ) THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_planned_end_shape
      CHECK (
        (time_mode = 'ACTUAL' AND planned_end_at IS NULL)
        OR (time_mode IN ('SESSION_END', 'DURATION') AND planned_end_at > joined_at)
      );
  END IF;
END $$;

ALTER TABLE bms_board_game_billing_groups
  ADD COLUMN IF NOT EXISTS merged_into_group_id UUID;

DO $$
DECLARE target text;
BEGIN
  FOR target IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bms_board_game_billing_groups'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%OPEN%'
       AND pg_get_constraintdef(oid) LIKE '%CLOSING%'
       AND pg_get_constraintdef(oid) LIKE '%PAID%'
       AND pg_get_constraintdef(oid) LIKE '%CANCELLED%'
  LOOP
    EXECUTE format('ALTER TABLE bms_board_game_billing_groups DROP CONSTRAINT %I', target);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_billing_groups'::regclass
       AND conname = 'bms_board_game_groups_status_check'
  ) THEN
    ALTER TABLE bms_board_game_billing_groups
      ADD CONSTRAINT bms_board_game_groups_status_check
      CHECK (status IN ('OPEN', 'CLOSING', 'PAID', 'CANCELLED', 'MERGED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_billing_groups'::regclass
       AND conname = 'bms_board_game_groups_merged_into_fk'
  ) THEN
    ALTER TABLE bms_board_game_billing_groups
      ADD CONSTRAINT bms_board_game_groups_merged_into_fk
      FOREIGN KEY (tenant_id, merged_into_group_id)
      REFERENCES bms_board_game_billing_groups(tenant_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_billing_groups'::regclass
       AND conname = 'bms_board_game_groups_merged_shape'
  ) THEN
    ALTER TABLE bms_board_game_billing_groups
      ADD CONSTRAINT bms_board_game_groups_merged_shape
      CHECK ((status = 'MERGED') = (merged_into_group_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_board_game_groups_merged_into
  ON bms_board_game_billing_groups (tenant_id, merged_into_group_id)
  WHERE merged_into_group_id IS NOT NULL;

COMMENT ON COLUMN bms_board_game_session_participants.time_mode IS
  'ACTUAL bills elapsed time; SESSION_END follows the visit end snapshot; DURATION owns an independent purchased-time end.';
COMMENT ON COLUMN bms_board_game_session_participants.planned_end_at IS
  'Per-player purchased-time boundary. Billing charges at least through this instant; NULL means actual elapsed time.';
COMMENT ON COLUMN bms_board_game_billing_groups.merged_into_group_id IS
  'Destination bill that absorbed this group while both were still OPEN.';

COMMIT;

-- ROLLBACK (only before any MERGED group or per-player time has been used):
-- DROP INDEX IF EXISTS idx_bms_board_game_groups_merged_into;
-- ALTER TABLE bms_board_game_billing_groups DROP CONSTRAINT IF EXISTS bms_board_game_groups_merged_shape;
-- ALTER TABLE bms_board_game_billing_groups DROP CONSTRAINT IF EXISTS bms_board_game_groups_merged_into_fk;
-- ALTER TABLE bms_board_game_billing_groups DROP COLUMN IF EXISTS merged_into_group_id;
-- ALTER TABLE bms_board_game_session_participants DROP CONSTRAINT IF EXISTS bms_board_game_participants_planned_end_shape;
-- ALTER TABLE bms_board_game_session_participants DROP CONSTRAINT IF EXISTS bms_board_game_participants_time_mode_check;
-- ALTER TABLE bms_board_game_session_participants DROP COLUMN IF EXISTS planned_end_at;
-- ALTER TABLE bms_board_game_session_participants DROP COLUMN IF EXISTS time_mode;
