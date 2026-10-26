BEGIN;
-- Training attendance/practice evidence is not a passing assessment. Preserve all existing rows.
ALTER TABLE bms_operation_learning DROP CONSTRAINT IF EXISTS bms_operation_learning_kind_check;
ALTER TABLE bms_operation_learning ADD CONSTRAINT bms_operation_learning_kind_check CHECK(kind IN ('ACK','TRAINED','PASS','PRACTICE'));
COMMIT;
-- ROLLBACK: disable training commands; retain TRAINED evidence and the widened constraint.
