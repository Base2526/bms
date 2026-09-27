-- =============================================================
-- 10.23  รายงานภาษีซื้อใน generated report engine
-- -------------------------------------------------------------
-- โค้ดสร้างไฟล์ VAT_PURCHASE ได้ แต่ bms_generated_reports มี CHECK แบบ allow-list
-- จึงต้องเพิ่มชนิดนี้ก่อน deploy มิฉะนั้นไฟล์จะถูกเขียนแล้วแต่บันทึกประวัติไม่สำเร็จ
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
      'VAT_PURCHASE',
      'STOCK_LEDGER'
    )
  );

COMMENT ON CONSTRAINT bms_generated_reports_report_type_check
  ON bms_generated_reports IS
  'Report types supported by the shared admin, GraphQL and AI report engine (10.23 adds VAT_PURCHASE).';

COMMIT;

-- ROLLBACK (ลบ/ย้ายแถว VAT_PURCHASE ก่อน):
-- DELETE FROM bms_generated_reports WHERE report_type = 'VAT_PURCHASE';
-- แล้วรันบล็อก CHECK ของ 10.9 ซ้ำ
