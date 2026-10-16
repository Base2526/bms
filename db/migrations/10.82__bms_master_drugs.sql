-- Recovery-safe entry point for SQL clients such as HeidiSQL. Run the whole file.
ROLLBACK;
BEGIN;

-- Phase 7: global drug references are suggestions only. A tenant pharmacist
-- still owns and approves every bms_pharmacy_product_policies row.
CREATE TABLE IF NOT EXISTS bms_master_drugs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'TH',
  generic_name TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT NOT NULL,
  regulatory_class TEXT NOT NULL CHECK (regulatory_class IN (
    'HOUSEHOLD_REMEDY','DANGEROUS_DRUG','SPECIALLY_CONTROLLED_DRUG','OTHER_DRUG'
  )),
  suggested_sale_policy TEXT NOT NULL CHECK (suggested_sale_policy IN (
    'DIRECT_SALE','SHORT_SAFETY_CHECK','PHARMACIST_APPROVAL',
    'PRESCRIPTION_REQUIRED','ONLINE_SALE_PROHIBITED'
  )),
  suggested_quantity_limit INTEGER CHECK (
    suggested_quantity_limit IS NULL OR suggested_quantity_limit > 0
  ),
  barcodes TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  reviewed_by_pharmacist BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by_pharmacist_name TEXT,
  reviewed_by_pharmacist_license_no TEXT,
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (code <> '' AND generic_name <> '' AND dosage_form <> '' AND strength <> ''),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (
    reviewed_by_pharmacist = FALSE OR (
      reviewed_by_pharmacist_name IS NOT NULL
      AND reviewed_by_pharmacist_license_no IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_bms_master_drugs_lookup
  ON bms_master_drugs(active, generic_name, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_master_drugs_current
  ON bms_master_drugs(code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_bms_master_drugs_barcodes
  ON bms_master_drugs USING GIN(barcodes);

-- A deliberately inactive, visibly fake shape example. It cannot be returned
-- as an applicable recommendation. Do not replace this with real drug content
-- until a named licensed pharmacist owns and reviews the dataset.
INSERT INTO bms_master_drugs (
  code,country_code,generic_name,dosage_form,strength,regulatory_class,
  suggested_sale_policy,suggested_quantity_limit,barcodes,source,source_version,
  reviewed_by_pharmacist,version,active
) VALUES (
  'SAMPLE-DO-NOT-USE','TH','ตัวอย่างเท่านั้น — ห้ามใช้ตัดสินนโยบายยา',
  'SAMPLE','SAMPLE','OTHER_DRUG','PHARMACIST_APPROVAL',NULL,'{}',
  'BMS_SAMPLE_NOT_CLINICALLY_REVIEWED','10.82',FALSE,1,FALSE
) ON CONFLICT (code,version) DO NOTHING;

-- Phase 6 remains the authority for whether a barcode is platform-approved.
-- A drug can declare intended barcodes above, but automatic tenant matching
-- uses this reviewed link only.
ALTER TABLE bms_master_barcodes
  ADD COLUMN IF NOT EXISTS master_drug_id UUID REFERENCES bms_master_drugs(id);
CREATE INDEX IF NOT EXISTS idx_bms_master_barcodes_master_drug
  ON bms_master_barcodes(master_drug_id)
  WHERE status = 'APPROVED' AND master_drug_id IS NOT NULL;

-- Freeze exactly what a shop chose to copy. Later master edits never rewrite
-- an existing shop policy or its approval state.
ALTER TABLE bms_pharmacy_product_policies
  ADD COLUMN IF NOT EXISTS master_drug_id UUID REFERENCES bms_master_drugs(id),
  ADD COLUMN IF NOT EXISTS master_drug_code TEXT,
  ADD COLUMN IF NOT EXISTS master_drug_version INTEGER,
  ADD COLUMN IF NOT EXISTS master_drug_suggestion_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS master_drug_suggestion_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS master_drug_suggestion_applied_by UUID REFERENCES users(id);

ALTER TABLE bms_pharmacy_product_policies
  DROP CONSTRAINT IF EXISTS bms_pharmacy_product_policies_regulatory_evidence_check;
ALTER TABLE bms_pharmacy_product_policies
  ADD CONSTRAINT bms_pharmacy_product_policies_regulatory_evidence_check
    CHECK (regulatory_evidence_source IN (
      'UNKNOWN','PRODUCT_LABEL','FDA_REGISTRATION','FDA_ANNOUNCEMENT',
      'SUPPLIER_DOCUMENT','PHARMACIST_REVIEW','MASTER_DRUG_REFERENCE'
    ));

-- bms_app deliberately has SELECT-only table grants below. These narrowly
-- scoped functions are the only write paths used after the application has
-- already enforced platform-admin RBAC; both keep history/link updates atomic.
CREATE OR REPLACE FUNCTION public.upsert_master_drug(
  p_id UUID,
  p_code TEXT,
  p_country_code TEXT,
  p_generic_name TEXT,
  p_dosage_form TEXT,
  p_strength TEXT,
  p_regulatory_class TEXT,
  p_suggested_sale_policy TEXT,
  p_suggested_quantity_limit INTEGER,
  p_barcodes TEXT[],
  p_source TEXT,
  p_source_version TEXT,
  p_reviewed_by_pharmacist BOOLEAN,
  p_reviewer_name TEXT,
  p_reviewer_license_no TEXT,
  p_initial_version INTEGER,
  p_active BOOLEAN
) RETURNS SETOF public.bms_master_drugs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous public.bms_master_drugs%ROWTYPE;
  v_saved public.bms_master_drugs%ROWTYPE;
  v_version INTEGER;
  v_conflicting_barcode TEXT;
BEGIN
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_previous
      FROM public.bms_master_drugs
     WHERE id = p_id AND effective_to IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MASTER_DRUG_NOT_FOUND_OR_SUPERSEDED'; END IF;
    IF v_previous.code <> p_code THEN RAISE EXCEPTION 'MASTER_DRUG_CODE_IMMUTABLE'; END IF;
    v_version := v_previous.version + 1;
    UPDATE public.bms_master_drugs
       SET active = FALSE, effective_to = now(), updated_at = now()
     WHERE id = p_id;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.bms_master_drugs
       WHERE code = p_code AND effective_to IS NULL
    ) THEN RAISE EXCEPTION 'MASTER_DRUG_CODE_EXISTS'; END IF;
    v_version := p_initial_version;
  END IF;

  INSERT INTO public.bms_master_drugs (
    code,country_code,generic_name,dosage_form,strength,regulatory_class,
    suggested_sale_policy,suggested_quantity_limit,barcodes,source,source_version,
    reviewed_by_pharmacist,reviewed_by_pharmacist_name,
    reviewed_by_pharmacist_license_no,reviewed_at,version,active
  ) VALUES (
    p_code,p_country_code,p_generic_name,p_dosage_form,p_strength,p_regulatory_class,
    p_suggested_sale_policy,p_suggested_quantity_limit,COALESCE(p_barcodes,'{}'),p_source,p_source_version,
    p_reviewed_by_pharmacist,p_reviewer_name,p_reviewer_license_no,
    CASE WHEN p_reviewed_by_pharmacist THEN now() ELSE NULL END,v_version,p_active
  ) RETURNING * INTO v_saved;

  SELECT barcode_ref.barcode INTO v_conflicting_barcode
    FROM public.bms_master_barcodes barcode_ref
    JOIN public.bms_master_drugs linked ON linked.id = barcode_ref.master_drug_id
   WHERE barcode_ref.status = 'APPROVED'
     AND barcode_ref.barcode = ANY(COALESCE(p_barcodes,'{}'))
     AND linked.code <> p_code
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'MASTER_DRUG_BARCODE_ALREADY_LINKED:%', v_conflicting_barcode;
  END IF;

  UPDATE public.bms_master_barcodes barcode_ref
     SET master_drug_id = NULL, updated_at = now()
   WHERE barcode_ref.master_drug_id IN (
     SELECT id FROM public.bms_master_drugs WHERE code = p_code
   ) AND NOT (barcode_ref.barcode = ANY(COALESCE(p_barcodes,'{}')));
  IF p_active THEN
    UPDATE public.bms_master_barcodes
       SET master_drug_id = v_saved.id, updated_at = now()
     WHERE status = 'APPROVED'
       AND barcode = ANY(COALESCE(p_barcodes,'{}'));
  END IF;

  RETURN NEXT v_saved;
END $$;

CREATE OR REPLACE FUNCTION public.review_master_barcode(
  p_id UUID,
  p_name TEXT,
  p_brand TEXT,
  p_size_text TEXT,
  p_unit_code TEXT,
  p_category_hint TEXT,
  p_status TEXT
) RETURNS SETOF public.bms_master_barcodes
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_saved public.bms_master_barcodes%ROWTYPE;
  v_matches UUID[];
BEGIN
  UPDATE public.bms_master_barcodes SET
    name=p_name,brand=NULLIF(p_brand,''),size_text=NULLIF(p_size_text,''),
    unit_code=NULLIF(p_unit_code,''),category_hint=NULLIF(p_category_hint,''),status=p_status,
    source=CASE WHEN source='MERCHANT_CONFIRMED' THEN source ELSE 'PLATFORM_CURATED' END,
    updated_at=now()
   WHERE id=p_id
   RETURNING * INTO v_saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'BARCODE_NOT_FOUND'; END IF;

  IF p_status = 'APPROVED' AND v_saved.master_drug_id IS NULL THEN
    SELECT array_agg(candidate.id ORDER BY candidate.code) INTO v_matches
      FROM (
        SELECT id,code FROM public.bms_master_drugs
         WHERE active=TRUE AND effective_to IS NULL AND v_saved.barcode=ANY(barcodes)
         ORDER BY code LIMIT 2
      ) candidate;
    IF cardinality(v_matches) = 1 THEN
      UPDATE public.bms_master_barcodes
         SET master_drug_id=v_matches[1],updated_at=now()
       WHERE id=p_id AND master_drug_id IS NULL
       RETURNING * INTO v_saved;
    END IF;
  END IF;
  RETURN NEXT v_saved;
END $$;

SELECT public.create_global_revision_trigger('bms_master_drugs');

REVOKE ALL ON TABLE bms_master_drugs FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE bms_master_drugs FROM bms_app;
GRANT SELECT ON TABLE bms_master_drugs TO bms_app;
REVOKE ALL ON TABLE bms_master_drugs_revisions FROM PUBLIC;
GRANT SELECT ON TABLE bms_master_drugs_revisions TO bms_app;
REVOKE ALL ON FUNCTION public.upsert_master_drug(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT[],TEXT,TEXT,BOOLEAN,TEXT,TEXT,INTEGER,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_drug(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT[],TEXT,TEXT,BOOLEAN,TEXT,TEXT,INTEGER,BOOLEAN) TO bms_app;
REVOKE ALL ON FUNCTION public.review_master_barcode(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_master_barcode(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO bms_app;

COMMENT ON TABLE bms_master_drugs IS 'Global drug-policy suggestions. Never changes or approves a tenant policy automatically.';
COMMENT ON COLUMN bms_master_drugs.reviewed_by_pharmacist IS 'Dataset review flag only; it is never a cross-tenant sale approval.';
COMMENT ON COLUMN bms_pharmacy_product_policies.master_drug_suggestion_snapshot IS 'Immutable-at-application snapshot of the optional global recommendation copied into this tenant policy.';

-- ROLLBACK (after rolling the app back and preserving tenant snapshots):
-- ALTER TABLE bms_pharmacy_product_policies DROP COLUMN master_drug_suggestion_applied_by,
--   DROP COLUMN master_drug_suggestion_applied_at, DROP COLUMN master_drug_suggestion_snapshot,
--   DROP COLUMN master_drug_version, DROP COLUMN master_drug_code, DROP COLUMN master_drug_id;
-- ALTER TABLE bms_master_barcodes DROP COLUMN master_drug_id;
-- DROP TABLE bms_master_drugs_revisions;
-- DROP FUNCTION public.review_master_barcode(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);
-- DROP FUNCTION public.upsert_master_drug(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT[],TEXT,TEXT,BOOLEAN,TEXT,TEXT,INTEGER,BOOLEAN);
-- DROP TABLE bms_master_drugs;

COMMIT;
