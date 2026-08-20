-- =============================================================
-- 9.10 — POS petty-cash wallet integrity hardening
-- -------------------------------------------------------------
-- IN คือเงินที่มาจากนอกลิ้นชักและไม่ผูกกะ ส่วน OUT ใน wallet รุ่นนี้เกิดได้
-- จากเอกสารค่าใช้จ่ายที่ผูกกะ/เครื่องเท่านั้น ปิดช่องไม่ให้ code path ใหม่ใน
-- อนาคตเขียน ledger กลับทิศหรือสร้างยอดที่อธิบายไม่ได้
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_pos_petty_cash_ledger'::regclass
       AND conname = 'bms_pos_petty_cash_ledger_shape_check'
  ) THEN
    ALTER TABLE bms_pos_petty_cash_ledger
      ADD CONSTRAINT bms_pos_petty_cash_ledger_shape_check
      CHECK (
        (direction = 'IN'
          AND source IN ('OWNER_PERSONAL','BUSINESS_ACCOUNT')
          AND shift_id IS NULL
          AND device_id IS NULL)
        OR
        (direction = 'OUT'
          AND source = 'EXPENSE'
          AND shift_id IS NOT NULL
          AND device_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_pos_petty_cash_ledger'::regclass
       AND conname = 'bms_pos_petty_cash_ledger_text_bounds_check'
  ) THEN
    ALTER TABLE bms_pos_petty_cash_ledger
      ADD CONSTRAINT bms_pos_petty_cash_ledger_text_bounds_check
      CHECK (
        char_length(reason) <= 200
        AND char_length(evidence_ref) <= 300
        AND char_length(idempotency_key) <= 200
        AND request_hash ~ '^[0-9a-f]{64}$'
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT bms_pos_petty_cash_ledger_shape_check ON bms_pos_petty_cash_ledger IS
  'Funding is IN from outside the till; spending is OUT through a shift expense';
