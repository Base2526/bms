-- =============================================================
-- 7.96  POS runtime readiness
-- -------------------------------------------------------------
-- Device authentication runs on every /api/pos/* request. The token is a
-- random per-register credential, so it should be both unique and indexed.
--
-- Safe to re-run. NULL tokens remain allowed for unpaired devices.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_devices_token_hash
  ON bms_pos_devices (token_hash)
  WHERE token_hash IS NOT NULL;
