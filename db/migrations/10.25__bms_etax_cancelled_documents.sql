-- Keep superseded, unsent tax documents in the e-Tax audit trail without
-- allowing the worker to submit them after a full invoice has replaced them.

BEGIN;

ALTER TABLE bms_etax_submissions
  DROP CONSTRAINT IF EXISTS bms_etax_submissions_status_check;

ALTER TABLE bms_etax_submissions
  ADD CONSTRAINT bms_etax_submissions_status_check
  CHECK (status IN (
    'PENDING', 'BUILT', 'SIGNED', 'SENT', 'ACCEPTED', 'REJECTED', 'FAILED', 'CANCELLED'
  ));

-- Repair old queue rows whose document was already cancelled before this
-- state existed. SENT/ACCEPTED rows remain intact because the recipient may
-- already hold the transmitted document.
UPDATE bms_etax_submissions s
   SET status = 'CANCELLED',
       last_error = COALESCE(s.last_error, 'เอกสารถูกยกเลิกก่อนนำส่ง'),
       next_attempt_at = NULL,
       settled_at = COALESCE(s.settled_at, now()),
       updated_at = now()
  FROM bms_tax_documents d
 WHERE d.id = s.document_id
   AND d.tenant_id = s.tenant_id
   AND d.cancelled_at IS NOT NULL
   AND s.status IN ('PENDING', 'BUILT', 'SIGNED', 'FAILED');

COMMIT;
