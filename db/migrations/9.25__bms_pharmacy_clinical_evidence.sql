-- =============================================================
-- 9.25  Pharmacy clinical evidence captured at the counter
-- -------------------------------------------------------------
-- The counter could dispense against a pharmacist's approval but had nowhere to
-- record *why* it was lawful: no prescription image, no prescription reference,
-- no counselling note. This table is that record.
--
-- Three kinds, one table, because they are one body of evidence for one case and
-- are always read together:
--   PRESCRIPTION_IMAGE  file_id set,   text_value NULL
--   PRESCRIPTION_REF    file_id NULL,  text_value = the prescriber's reference
--   COUNSELING_NOTE     file_id NULL,  text_value = what the pharmacist advised
-- The CHECK below makes the wrong combination unrepresentable rather than
-- leaving it to the service layer.
--
-- Retention is manual by decision: nothing expires these rows. deleted_at is a
-- soft delete so a removal is still auditable — a prescription that vanished
-- without trace is worse than one that is marked deleted.
--
-- **Never serve a PRESCRIPTION_IMAGE through /api/files/[id].** That route has
-- no authentication and its ids are sequential integers, so anything reachable
-- there is effectively public. file_id is deliberately never returned to a
-- client; images are streamed by
-- /api/bms/pharmacy/evidence/[id]/file, which requires a session,
-- pharmacy.evidence.read, and a tenant match on the row below.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pharmacy_clinical_evidence (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES bms_pharmacy_assessments(id) ON DELETE CASCADE,

  kind          TEXT NOT NULL CHECK (kind IN
                  ('PRESCRIPTION_IMAGE', 'PRESCRIPTION_REF', 'COUNSELING_NOTE')),

  -- files is a global table with no tenant_id of its own, so the tenant scope of
  -- an image is this row and nothing else. Keep it that way.
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  file_name     TEXT,
  file_mimetype TEXT,
  file_size     BIGINT,

  text_value    TEXT,

  -- who captured it: a cashier at the register, or the pharmacist in the queue
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'pos' CHECK (source IN ('pos', 'queue')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT bms_pharmacy_clinical_evidence_shape_check CHECK (
    (kind = 'PRESCRIPTION_IMAGE' AND file_id IS NOT NULL AND text_value IS NULL)
    OR (kind IN ('PRESCRIPTION_REF', 'COUNSELING_NOTE')
        AND file_id IS NULL
        AND text_value IS NOT NULL
        AND length(btrim(text_value)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_pharm_evidence_case
  ON bms_pharmacy_clinical_evidence(tenant_id, assessment_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE bms_pharmacy_clinical_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_clinical_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_clinical_evidence_tenant_isolation
  ON bms_pharmacy_clinical_evidence;
CREATE POLICY bms_pharmacy_clinical_evidence_tenant_isolation
  ON bms_pharmacy_clinical_evidence
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pharmacy_clinical_evidence TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- bms_app must be able to resolve an image's storage path when streaming it
-- through the gated route. Read-only: the pharmacy code never writes files.
GRANT SELECT ON files TO bms_app;

-- ---- permissions ----
-- Pharmacist only. Administrator is a super-role in lib/bms/permissions.ts and
-- receives every permission automatically, so this grants exactly the audience
-- that was asked for (admin + pharmacist) and deliberately leaves Manager out:
-- a manager can already read the case, but a prescription image is health data
-- about an identifiable patient and is a narrower audience than the case itself.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Pharmacist', 'pharmacy.evidence.read'),
  ('Pharmacist', 'pharmacy.evidence.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_pharmacy_clinical_evidence IS
  'Prescription images/references and counselling notes for one pharmacy case; manual retention, soft delete, images served only through the permission-gated route';
