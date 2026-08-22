-- Structured regulatory classification for pharmacy product policies.
-- Do not infer these values from product names/categories: they must be
-- supported by a label, FDA record/announcement, supplier document, or a
-- licensed pharmacist's documented review.

DO $$
DECLARE
  first_install BOOLEAN;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'bms_pharmacy_product_policies'
       AND column_name = 'regulatory_framework'
  ) INTO first_install;

  ALTER TABLE bms_pharmacy_product_policies
    ADD COLUMN IF NOT EXISTS regulatory_framework TEXT NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS regulatory_evidence_source TEXT NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS regulatory_evidence_ref TEXT;

  -- Normalize legacy free text once. Re-running this migration must never
  -- overwrite a pharmacist-reviewed classification.
  IF first_install THEN
    UPDATE bms_pharmacy_product_policies
       SET regulatory_framework = CASE
             WHEN product_type IN ('DRUG', 'HOUSEHOLD_REMEDY') THEN 'DRUG'
             WHEN product_type = 'MEDICAL_DEVICE' THEN 'MEDICAL_DEVICE'
             WHEN product_type = 'GENERAL_PRODUCT' THEN 'NOT_REGULATED'
             ELSE 'UNKNOWN'
           END,
           regulatory_class = CASE
             WHEN product_type = 'HOUSEHOLD_REMEDY' THEN 'HOUSEHOLD_REMEDY'
             WHEN product_type = 'DRUG' AND regulatory_class IN
                  ('HOUSEHOLD_REMEDY', 'DANGEROUS_DRUG', 'SPECIALLY_CONTROLLED_DRUG', 'OTHER_DRUG')
               THEN regulatory_class
             WHEN product_type = 'MEDICAL_DEVICE' AND regulatory_class IN
                  ('MEDICAL_DEVICE_CLASS_1', 'MEDICAL_DEVICE_CLASS_2',
                   'MEDICAL_DEVICE_CLASS_3', 'MEDICAL_DEVICE_CLASS_4')
               THEN regulatory_class
             WHEN product_type = 'GENERAL_PRODUCT' THEN 'NOT_APPLICABLE'
             ELSE 'UNKNOWN'
           END,
           status = 'DRAFT',
           reviewed_by = NULL,
           reviewed_at = NULL,
           updated_at = now();
  END IF;
END $$;

ALTER TABLE bms_pharmacy_product_policies
  DROP CONSTRAINT IF EXISTS bms_pharmacy_product_policies_regulatory_framework_check,
  DROP CONSTRAINT IF EXISTS bms_pharmacy_product_policies_regulatory_class_check,
  DROP CONSTRAINT IF EXISTS bms_pharmacy_product_policies_regulatory_evidence_check;

ALTER TABLE bms_pharmacy_product_policies
  ADD CONSTRAINT bms_pharmacy_product_policies_regulatory_framework_check
    CHECK (regulatory_framework IN ('UNKNOWN', 'NOT_REGULATED', 'DRUG', 'MEDICAL_DEVICE')),
  ADD CONSTRAINT bms_pharmacy_product_policies_regulatory_class_check
    CHECK (
      (regulatory_framework = 'UNKNOWN' AND regulatory_class = 'UNKNOWN') OR
      (regulatory_framework = 'NOT_REGULATED' AND regulatory_class = 'NOT_APPLICABLE') OR
      (regulatory_framework = 'DRUG' AND regulatory_class IN (
        'UNKNOWN', 'HOUSEHOLD_REMEDY', 'DANGEROUS_DRUG',
        'SPECIALLY_CONTROLLED_DRUG', 'OTHER_DRUG'
      )) OR
      (regulatory_framework = 'MEDICAL_DEVICE' AND regulatory_class IN (
        'UNKNOWN', 'MEDICAL_DEVICE_CLASS_1', 'MEDICAL_DEVICE_CLASS_2',
        'MEDICAL_DEVICE_CLASS_3', 'MEDICAL_DEVICE_CLASS_4'
      ))
    ),
  ADD CONSTRAINT bms_pharmacy_product_policies_regulatory_evidence_check
    CHECK (regulatory_evidence_source IN (
      'UNKNOWN', 'PRODUCT_LABEL', 'FDA_REGISTRATION', 'FDA_ANNOUNCEMENT',
      'SUPPLIER_DOCUMENT', 'PHARMACIST_REVIEW'
    ));
