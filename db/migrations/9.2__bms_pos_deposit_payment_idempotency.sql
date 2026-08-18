-- =============================================================
-- 9.2 — idempotency ของการรับ/เพิ่มเงินมัดจำ
-- -------------------------------------------------------------
-- เครื่อง POS retry เมื่อ response หายได้เสมอ การเพิ่มเงินมัดจำจึงห้ามสร้าง
-- payment ซ้ำจากคำขอเดิม ใช้ key ที่เครื่องสร้างและบังคับ unique ต่อ tenant
-- =============================================================

ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_payments_idempotency
  ON bms_payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN bms_payments.idempotency_key IS
  'Stable client key for retry-safe payment writes; currently required by POS deposit take/add (9.2)';
