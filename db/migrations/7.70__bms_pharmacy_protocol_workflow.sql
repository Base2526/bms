-- Data-driven pharmacy protocol discovery and clinical review workflow.

ALTER TABLE bms_pharmacy_protocols
  ADD COLUMN IF NOT EXISTS display_label TEXT,
  ADD COLUMN IF NOT EXISTS trigger_terms TEXT[] NOT NULL DEFAULT '{}';

UPDATE bms_pharmacy_protocols
   SET display_label = CASE protocol_key
     WHEN 'headache' THEN 'ปวดหัว'
     WHEN 'cough' THEN 'ไอ'
     WHEN 'diarrhea' THEN 'ท้องเสีย'
     ELSE name
   END
 WHERE display_label IS NULL OR BTRIM(display_label) = '';

UPDATE bms_pharmacy_protocols
   SET trigger_terms = CASE protocol_key
     WHEN 'headache' THEN ARRAY['ปวดหัว','ปวดศีรษะ','migraine','headache']
     WHEN 'cough' THEN ARRAY['ไอ','cough']
     WHEN 'diarrhea' THEN ARRAY['ท้องเสีย','ถ่ายเหลว','diarrhea']
     ELSE ARRAY[protocol_key]
   END
 WHERE COALESCE(array_length(trigger_terms, 1), 0) = 0;

ALTER TABLE bms_pharmacy_protocols
  ALTER COLUMN display_label SET NOT NULL;

ALTER TABLE bms_pharmacy_protocols
  DROP CONSTRAINT IF EXISTS bms_pharmacy_protocols_live_state_check;

ALTER TABLE bms_pharmacy_protocols
  ADD CONSTRAINT bms_pharmacy_protocols_live_state_check
  CHECK (
    NOT enabled OR (
      status = 'APPROVED'
      AND clinically_approved = TRUE
      AND COALESCE(array_length(trigger_terms, 1), 0) > 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_bms_pharmacy_protocols_trigger_terms
  ON bms_pharmacy_protocols USING GIN (trigger_terms)
  WHERE enabled AND clinically_approved AND status = 'APPROVED';
