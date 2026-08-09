-- =============================================================
-- 7.66  Pharmacy intake — customer confirmation before queue
-- -------------------------------------------------------------
-- Intake should no longer jump straight from COMPLETE to pharmacist queue.
-- We store a customer-facing confirmation snapshot on the assessment,
-- pause in PENDING_CONFIRMATION, then only move to WAITING_FOR_PHARMACIST
-- after the customer explicitly confirms the summarized data.
-- =============================================================

ALTER TABLE bms_pharmacy_assessments
  ADD COLUMN IF NOT EXISTS customer_confirmation_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (customer_confirmation_status IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED')),
  ADD COLUMN IF NOT EXISTS customer_confirmation_summary JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS customer_confirmed_at TIMESTAMPTZ;

ALTER TABLE bms_pharmacy_assessments
  DROP CONSTRAINT IF EXISTS bms_pharmacy_assessments_status_check;

ALTER TABLE bms_pharmacy_assessments
  ADD CONSTRAINT bms_pharmacy_assessments_status_check
  CHECK (status IN (
    'DRAFT',
    'COLLECTING_INFORMATION',
    'PENDING_CONFIRMATION',
    'WAITING_FOR_PHARMACIST',
    'PHARMACIST_REVIEWING',
    'NEED_MORE_INFORMATION',
    'APPROVED',
    'REJECTED',
    'REFER_TO_DOCTOR',
    'EMERGENCY_REFERRAL',
    'CLOSED'
  ));

UPDATE bms_pharmacy_assessments
SET customer_confirmation_status = CASE
      WHEN status IN (
        'WAITING_FOR_PHARMACIST',
        'PHARMACIST_REVIEWING',
        'APPROVED',
        'REJECTED',
        'REFER_TO_DOCTOR',
        'EMERGENCY_REFERRAL',
        'CLOSED'
      ) THEN 'CONFIRMED'
      ELSE 'NOT_REQUESTED'
    END,
    customer_confirmed_at = CASE
      WHEN customer_confirmed_at IS NULL
        AND status IN (
          'WAITING_FOR_PHARMACIST',
          'PHARMACIST_REVIEWING',
          'APPROVED',
          'REJECTED',
          'REFER_TO_DOCTOR',
          'EMERGENCY_REFERRAL',
          'CLOSED'
        )
      THEN updated_at
      ELSE customer_confirmed_at
    END
WHERE customer_confirmation_status = 'NOT_REQUESTED';