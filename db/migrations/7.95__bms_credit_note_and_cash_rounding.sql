-- =============================================================
-- 7.95  BMS — ใบลดหนี้ (อ้างอิงใบเดิม) + ปัดเศษเงินสด
-- -------------------------------------------------------------
-- ต้องรัน 7.88 ก่อน
--
-- 1) ใบลดหนี้ต้อง "อ้างอิง" ใบเดิม ไม่ใช่ "แทนที่" ใบเดิม
--    7.88 มี replaces_document_id ซึ่งใช้กับกรณีใบเต็มออกแทนใบย่อ —
--    ใบเดิมถูกยกเลิก · แต่ตอนคืนของ ใบกำกับเดิม "ยังมีผลอยู่" แค่มีใบลดหนี้
--    มาลดยอดทีหลัง สองความสัมพันธ์นี้ต่างกัน จึงต้องคนละคอลัมน์
--    (ถ้าใช้ช่องเดียวกัน รายงานภาษีจะแยกไม่ออกว่าใบไหนถูกยกเลิก ใบไหนถูกลดยอด)
--
-- 2) ปัดเศษเงินสด — ใบวราภรณ์มีบรรทัด "ยอดเงินปัดเศษ" แยกต่างหาก
--    ปัดเฉพาะตอนรับเงินสด (บัตร/QR รับเต็มจำนวนอยู่แล้ว) และ
--    **ห้ามกระทบฐาน VAT** ยอดปัดเป็นบรรทัดของตัวเอง ไม่ใช่ส่วนลด
--
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. ใบลดหนี้อ้างอิงใบเดิม ----------------------------------------
ALTER TABLE bms_tax_documents
  ADD COLUMN IF NOT EXISTS references_document_id UUID REFERENCES bms_tax_documents(id),
  -- เหตุผลที่ลดหนี้ — กฎหมายบังคับให้ระบุ (รับคืนสินค้า / ลดราคา / คำนวณผิด)
  ADD COLUMN IF NOT EXISTS credit_reason TEXT,
  -- ยอดเดิมก่อนลด เพื่อให้ใบลดหนี้อ่านได้ครบโดยไม่ต้องเปิดใบเดิม
  ADD COLUMN IF NOT EXISTS original_total NUMERIC(12,2);

COMMENT ON COLUMN bms_tax_documents.references_document_id IS
  'ใบลดหนี้ชี้ไปที่ใบกำกับเดิมที่ยังมีผลอยู่ · ต่างจาก replaces_document_id ที่ใบเดิมถูกยกเลิก';

CREATE INDEX IF NOT EXISTS idx_bms_tax_documents_references
  ON bms_tax_documents (references_document_id) WHERE references_document_id IS NOT NULL;

-- ---- 2. ปัดเศษเงินสด -------------------------------------------------
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS cash_rounding TEXT NOT NULL DEFAULT 'NONE'
    CHECK (cash_rounding IN ('NONE', '0.25', '0.50', '1.00'));

COMMENT ON COLUMN bms_store_profile.cash_rounding IS
  'ปัดยอดรับเงินสดให้ลงตัว · ใช้เฉพาะบิลที่จ่ายสดล้วน · ไม่กระทบฐาน VAT';
