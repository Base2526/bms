-- =============================================================
-- 9.5 — retry-safe POS drawer cash movements
-- -------------------------------------------------------------
-- เงินเข้า/ออกอาจ commit แล้ว response หายได้เหมือนการขาย ถ้ากดซ้ำโดยไม่มี
-- stable key สูตรเงินที่ควรมีตอนปิดกะจะบันทึกรายการเดิมสองครั้ง
-- =============================================================

ALTER TABLE bms_pos_cash_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_cash_movements_idempotency
  ON bms_pos_cash_movements (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN bms_pos_cash_movements.idempotency_key IS
  'Stable POS client key; retrying one drawer movement returns the original row instead of moving cash twice';
