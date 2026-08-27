-- =============================================================
-- 9.31 — ช่องทางคืนเงินที่พนักงานเลือกสำหรับบิลจ่ายผสม
-- -------------------------------------------------------------
-- การชำระหลายวิธีถูก insert ใน transaction เดียวกัน ทำให้ created_at เท่ากัน
-- การเรียง created_at + UUID จึงไม่ได้แทนลำดับรับเงินจริง และอาจจัด QR/บัตร/เงินสด
-- ก่อนแบบสุ่ม การคืนบางส่วนต้องบันทึกว่าพนักงานเลือกช่องทางใดก่อน เพื่อให้ replay
-- คีย์เดิมตรวจได้ว่าเป็นคำขอเดิมจริงและประวัติตรวจสอบย้อนหลังได้
-- =============================================================

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS preferred_refund_method TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_returns_preferred_refund_method_check'
  ) THEN
    ALTER TABLE bms_pos_returns
      ADD CONSTRAINT bms_pos_returns_preferred_refund_method_check
      CHECK (
        preferred_refund_method IS NULL
        OR preferred_refund_method IN (
          'BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN bms_pos_returns.preferred_refund_method IS
  'ช่องทางจาก payment เดิมที่ผู้ทำรายการเลือกให้จัดสรรยอดคืนก่อน; NULL = fallback policy/void/client รุ่นเก่า (9.31)';
