-- =============================================================
-- 7.65  AI Pharmacy Intake Assistant — completeness/anomaly tracking
-- -------------------------------------------------------------
-- PR1 stores whether intake is actually complete enough to move into the
-- pharmacist queue, plus deterministic anomalies (e.g. impossible fever
-- temperature values) that should keep the case in the asking loop rather
-- than quietly submitting an incomplete case for manual review.
-- =============================================================

ALTER TABLE bms_pharmacy_assessments
  ADD COLUMN IF NOT EXISTS anomalies JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS completeness_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (completeness_status IN ('UNKNOWN', 'INCOMPLETE', 'CONFLICT', 'COMPLETE'));

UPDATE bms_pharmacy_assessments
   SET completeness_status = CASE
     WHEN status IN ('WAITING_FOR_PHARMACIST', 'PHARMACIST_REVIEWING', 'APPROVED', 'REJECTED', 'REFER_TO_DOCTOR', 'EMERGENCY_REFERRAL')
       AND COALESCE(array_length(missing_fields, 1), 0) = 0
       AND COALESCE(array_length(conflicting_fields, 1), 0) = 0
       THEN 'COMPLETE'
     WHEN COALESCE(array_length(conflicting_fields, 1), 0) > 0
       THEN 'CONFLICT'
     WHEN COALESCE(array_length(missing_fields, 1), 0) > 0
       THEN 'INCOMPLETE'
     ELSE completeness_status
   END
 WHERE completeness_status = 'UNKNOWN';
