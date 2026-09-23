-- =============================================================
-- 10.9  ชนิดรายงานภาษี: รายงานภาษีขาย + รายงานสินค้าและวัตถุดิบ
-- -------------------------------------------------------------
-- บทเรียนเดียวกับ 9.95: reportEngine สร้างไฟล์ได้ แต่ INSERT ลง bms_generated_reports
-- ถูก CHECK ปฏิเสธถ้าชนิดใหม่ไม่อยู่ในลิสต์ → ผู้ใช้เห็น "สร้างรายงานไม่สำเร็จ" หลังไฟล์
-- ถูกเขียนลงดิสก์ไปแล้ว · ต้อง apply ไฟล์นี้ก่อน deploy โค้ดที่เพิ่ม VAT_SALES/STOCK_LEDGER
--
-- ใส่ STOCK_LEDGER ไว้ล่วงหน้าในไฟล์เดียวกัน (เฟส 2 ของงานรายงานภาษี) เพื่อไม่ต้อง
-- เปลี่ยน CHECK ตัวเดิมสองรอบติดกัน · ชนิดที่ยังไม่มีโค้ดใช้ไม่ทำให้อะไรพัง
--
-- ก่อนรัน (read-only):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'bms_generated_reports_report_type_check';
-- =============================================================

BEGIN;

ALTER TABLE bms_generated_reports
  DROP CONSTRAINT IF EXISTS bms_generated_reports_report_type_check;

ALTER TABLE bms_generated_reports
  ADD CONSTRAINT bms_generated_reports_report_type_check
  CHECK (
    report_type IN (
      'SALES',
      'INVENTORY',
      'PROFIT',
      'PRODUCTS',
      'PAYMENTS',
      'PURCHASES',
      'CUSTOMERS',
      'OPERATIONS',
      'SPECIALIZED',
      'VAT_SALES',
      'STOCK_LEDGER'
    )
  );

COMMENT ON CONSTRAINT bms_generated_reports_report_type_check
  ON bms_generated_reports IS
  'Report types supported by the shared admin, REST, GraphQL and AI report engine (10.9 adds tax reports).';

COMMIT;

-- ROLLBACK (ลบ/ย้ายแถวที่ใช้สองชนิดใหม่ก่อน):
-- DELETE FROM bms_generated_reports WHERE report_type IN ('VAT_SALES','STOCK_LEDGER');
-- แล้วรันบล็อก CHECK ของ 9.95 ซ้ำ
