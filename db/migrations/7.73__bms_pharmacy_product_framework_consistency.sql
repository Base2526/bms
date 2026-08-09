-- Enforce consistency between the internal product type and the verified
-- regulatory framework. Previously saved contradictory rows fail closed and
-- return to Draft for human reclassification; the migration never guesses.

UPDATE bms_pharmacy_product_policies
   SET product_type = 'UNKNOWN',
       regulatory_framework = 'UNKNOWN',
       regulatory_class = 'UNKNOWN',
       regulatory_evidence_source = 'UNKNOWN',
       regulatory_evidence_ref = NULL,
       status = 'DRAFT',
       reviewed_by = NULL,
       reviewed_at = NULL,
       updated_at = now()
 WHERE NOT (
   (product_type = 'UNKNOWN' AND regulatory_framework = 'UNKNOWN') OR
   (product_type = 'GENERAL_PRODUCT' AND regulatory_framework = 'NOT_REGULATED') OR
   (product_type = 'MEDICAL_SUPPLY' AND regulatory_framework IN ('UNKNOWN','NOT_REGULATED','MEDICAL_DEVICE')) OR
   (product_type = 'MEDICAL_DEVICE' AND regulatory_framework = 'MEDICAL_DEVICE') OR
   (product_type = 'HOUSEHOLD_REMEDY' AND regulatory_framework = 'DRUG' AND regulatory_class = 'HOUSEHOLD_REMEDY') OR
   (product_type = 'DRUG' AND regulatory_framework = 'DRUG')
 );

ALTER TABLE bms_pharmacy_product_policies
  DROP CONSTRAINT IF EXISTS bms_pharmacy_product_policies_product_framework_check;

ALTER TABLE bms_pharmacy_product_policies
  ADD CONSTRAINT bms_pharmacy_product_policies_product_framework_check
  CHECK (
    (product_type = 'UNKNOWN' AND regulatory_framework = 'UNKNOWN') OR
    (product_type = 'GENERAL_PRODUCT' AND regulatory_framework = 'NOT_REGULATED') OR
    (product_type = 'MEDICAL_SUPPLY' AND regulatory_framework IN ('UNKNOWN','NOT_REGULATED','MEDICAL_DEVICE')) OR
    (product_type = 'MEDICAL_DEVICE' AND regulatory_framework = 'MEDICAL_DEVICE') OR
    (product_type = 'HOUSEHOLD_REMEDY' AND regulatory_framework = 'DRUG' AND regulatory_class = 'HOUSEHOLD_REMEDY') OR
    (product_type = 'DRUG' AND regulatory_framework = 'DRUG')
  );
