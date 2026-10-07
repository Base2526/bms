-- 10.45 Pharmacist-approved guidance for clinical questions the customer AI must not answer.
--
-- One row per (tenant, question code, locale). A customer reads a body only while it is
-- APPROVED, and only a licensed pharmacist (bms_is_licensed_pharmacist, no Administrator
-- shortcut) can approve. Editing an approved body returns it to DRAFT in the same statement
-- (enforced here by trigger, not only in the service) so an approved text cannot change
-- under a pharmacist's name.
--
-- No rows are seeded. Starting drafts live in apps/web/lib/bms/pharmacy/guidanceTemplates.ts
-- and become rows only when someone in the shop copies them in. Until a row is approved the
-- customer keeps receiving the fixed pharmacist handoff that exists today.
--
-- Reading this table is fail-safe in the pipeline: a missing table means "no approved
-- guidance", never an error, so this migration is not a deploy blocker and is deliberately
-- not listed in scripts/schemaReadiness.mts.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS bms_pharmacy_guidance_templates_revisions;
--   DROP TABLE IF EXISTS bms_pharmacy_guidance_templates;
--   DROP FUNCTION IF EXISTS bms_pharmacy_guidance_templates_guard();

CREATE TABLE IF NOT EXISTS bms_pharmacy_guidance_templates (
  id                   UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL CHECK (code IN (
                         'SYMPTOM_TO_DRUG', 'DRUG_INTERACTION', 'ALLERGY_SUBSTITUTE',
                         'SIDE_EFFECT', 'MISSED_DOSE', 'NOT_IMPROVING',
                         'COMPARE_WITH_PRESCRIBED', 'CHRONIC_CONDITION',
                         'SPECIAL_POPULATION', 'ANIMAL', 'RESTRICTED_PRODUCT'
                       )),
  locale               TEXT NOT NULL CHECK (locale IN ('th', 'en')),
  body                 TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  status               TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  approved_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  approved_license_no  TEXT,
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, locale),
  -- An approved row always says when it was approved. approved_by may become NULL later
  -- (user deleted) without un-approving the text, so it is not part of this check.
  CONSTRAINT bms_pharmacy_guidance_templates_approval_shape
    CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bms_pharmacy_guidance_templates_approved
  ON bms_pharmacy_guidance_templates (tenant_id, code, locale)
  WHERE status = 'APPROVED';

-- Any change to the body or code/locale of an APPROVED row drops it back to DRAFT and clears
-- the approval stamp; the version advances on every body change.
CREATE OR REPLACE FUNCTION bms_pharmacy_guidance_templates_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.locale IS DISTINCT FROM OLD.locale THEN
    NEW.version := OLD.version + 1;
    IF NEW.status = 'APPROVED' THEN
      NEW.status := 'DRAFT';
    END IF;
  END IF;
  IF NEW.status <> 'APPROVED' THEN
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approved_license_no := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bms_pharmacy_guidance_templates_guard_trg ON bms_pharmacy_guidance_templates;
CREATE TRIGGER bms_pharmacy_guidance_templates_guard_trg
  BEFORE UPDATE ON bms_pharmacy_guidance_templates
  FOR EACH ROW EXECUTE FUNCTION bms_pharmacy_guidance_templates_guard();

ALTER TABLE bms_pharmacy_guidance_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_guidance_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_guidance_templates_tenant_isolation ON bms_pharmacy_guidance_templates;
CREATE POLICY bms_pharmacy_guidance_templates_tenant_isolation ON bms_pharmacy_guidance_templates
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- No DELETE: a retired text is kept so "what did the customer read on that date" stays answerable.
GRANT SELECT, INSERT, UPDATE ON bms_pharmacy_guidance_templates TO bms_app;
SELECT public.create_revision_trigger('bms_pharmacy_guidance_templates');

COMMENT ON TABLE bms_pharmacy_guidance_templates IS
  'Pharmacist-approved customer guidance per clinical question type (10.45). Only APPROVED rows reach a customer; no medicine names, doses or safety claims.';
