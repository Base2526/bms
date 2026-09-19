-- =============================================================
-- 10.6 Board-game receipt evidence
-- -------------------------------------------------------------
-- The participant already freezes the numeric rate used for money. Freeze the
-- human label too so a later rate rename cannot rewrite a historical bill.
-- Entry/exit and charged-through timestamps are stored in charge_snapshot when
-- the group closes; these columns supply the immutable label for that snapshot.
-- =============================================================

ALTER TABLE bms_board_game_session_participants
  ADD COLUMN IF NOT EXISTS rate_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS rate_name_snapshot TEXT;

UPDATE bms_board_game_session_participants p
   SET rate_code_snapshot = r.code,
       rate_name_snapshot = r.name
  FROM bms_board_game_time_rates r
 WHERE r.tenant_id = p.tenant_id
   AND r.id = p.rate_id
   AND (p.rate_code_snapshot IS NULL OR p.rate_name_snapshot IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_participants_rate_label_shape'
       AND conrelid = 'bms_board_game_session_participants'::regclass
  ) THEN
    ALTER TABLE bms_board_game_session_participants
      ADD CONSTRAINT bms_board_game_participants_rate_label_shape
      CHECK (
        (
          (rate_code_snapshot IS NULL AND rate_name_snapshot IS NULL)
          OR
          (rate_code_snapshot IS NOT NULL
            AND rate_name_snapshot IS NOT NULL
            AND length(btrim(rate_code_snapshot)) BETWEEN 1 AND 60
            AND length(btrim(rate_name_snapshot)) BETWEEN 1 AND 120)
        )
        AND (NOT billable OR rate_code_snapshot IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_session_participants
  VALIDATE CONSTRAINT bms_board_game_participants_rate_label_shape;

COMMENT ON COLUMN bms_board_game_session_participants.rate_code_snapshot IS
  'Immutable rate code shown on board-game checkout and receipt evidence.';
COMMENT ON COLUMN bms_board_game_session_participants.rate_name_snapshot IS
  'Immutable customer-facing rate name shown on board-game checkout and receipt evidence.';
