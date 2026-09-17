-- =============================================================
-- 9.95  Generated report type expansion
-- -------------------------------------------------------------
-- Keep the persisted report audit/history table aligned with the report
-- engine. The original 7.53 constraint allowed only the first three report
-- types, which would reject the newer management report exports at insert.
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
      'SPECIALIZED'
    )
  );

COMMENT ON CONSTRAINT bms_generated_reports_report_type_check
  ON bms_generated_reports IS
  'Report types supported by the shared admin, REST, GraphQL and AI report engine.';

COMMIT;

-- ROLLBACK (remove/archive rows using the six expanded types first):
-- ALTER TABLE bms_generated_reports
--   DROP CONSTRAINT IF EXISTS bms_generated_reports_report_type_check;
-- ALTER TABLE bms_generated_reports
--   ADD CONSTRAINT bms_generated_reports_report_type_check
--   CHECK (report_type IN ('SALES', 'INVENTORY', 'PROFIT'));
