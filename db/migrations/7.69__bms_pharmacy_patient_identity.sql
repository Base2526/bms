-- Pharmacy patient identity safety.
-- A channel account owner is not necessarily the person receiving care.
-- New assessments must establish SELF/CHILD/PARENT/OTHER before reusing
-- consented patient memory. Historical SELF values came from an implicit
-- default rather than an explicit answer, so they must not be trusted.

-- Keep this migration recoverable when an operator accidentally ran 7.69
-- before 7.66. The canonical definitions remain in 7.66; these IF NOT EXISTS
-- guards prevent the patient-memory index from failing halfway through.
ALTER TABLE bms_pharmacy_assessments
  ADD COLUMN IF NOT EXISTS anomalies JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS completeness_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (completeness_status IN ('UNKNOWN', 'INCOMPLETE', 'CONFLICT', 'COMPLETE')),
  ADD COLUMN IF NOT EXISTS customer_confirmation_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (customer_confirmation_status IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED')),
  ADD COLUMN IF NOT EXISTS customer_confirmation_summary JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS customer_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkout_order_draft JSONB;

ALTER TABLE bms_pharmacy_assessments
  DROP CONSTRAINT IF EXISTS bms_pharmacy_assessments_status_check;

ALTER TABLE bms_pharmacy_assessments
  ADD CONSTRAINT bms_pharmacy_assessments_status_check
  CHECK (status IN (
    'DRAFT', 'COLLECTING_INFORMATION', 'PENDING_CONFIRMATION',
    'WAITING_FOR_PHARMACIST', 'PHARMACIST_REVIEWING', 'NEED_MORE_INFORMATION',
    'APPROVED', 'REJECTED', 'REFER_TO_DOCTOR', 'EMERGENCY_REFERRAL', 'CLOSED'
  ));

ALTER TABLE bms_pharmacy_assessments
  DROP CONSTRAINT IF EXISTS bms_pharmacy_assessments_patient_relationship_check;

-- Reset historical implicit SELF values only on the first run. Once the
-- default is UNKNOWN, later SELF values are explicit customer answers and
-- must survive an idempotent re-run.
DO $$
DECLARE
  relationship_default TEXT;
BEGIN
  SELECT pg_get_expr(def.adbin, def.adrelid)
    INTO relationship_default
    FROM pg_attribute attr
    JOIN pg_class cls ON cls.oid = attr.attrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    LEFT JOIN pg_attrdef def ON def.adrelid = attr.attrelid AND def.adnum = attr.attnum
   WHERE ns.nspname = current_schema()
     AND cls.relname = 'bms_pharmacy_assessments'
     AND attr.attname = 'patient_relationship';

  IF relationship_default ILIKE '%SELF%' THEN
    UPDATE bms_pharmacy_assessments
       SET patient_relationship = 'UNKNOWN', updated_at = now()
     WHERE patient_relationship = 'SELF';
  END IF;
END $$;

ALTER TABLE bms_pharmacy_assessments
  ALTER COLUMN patient_relationship SET DEFAULT 'UNKNOWN';

ALTER TABLE bms_pharmacy_assessments
  ADD CONSTRAINT bms_pharmacy_assessments_patient_relationship_check
  CHECK (patient_relationship IN ('UNKNOWN', 'SELF', 'CHILD', 'PARENT', 'OTHER'));

UPDATE bms_pharmacy_assessments assessment
   SET customer_id = conversation.customer_id,
       updated_at = now()
  FROM bms_conversations conversation
 WHERE assessment.tenant_id = conversation.tenant_id
   AND assessment.conversation_id = conversation.id
   AND assessment.customer_id IS NULL
   AND conversation.customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_pharmacy_assessments_patient_memory
  ON bms_pharmacy_assessments (tenant_id, customer_id, patient_relationship, updated_at DESC)
  WHERE consent_status = 'GRANTED'
    AND customer_confirmation_status = 'CONFIRMED'
    AND deleted_at IS NULL;
