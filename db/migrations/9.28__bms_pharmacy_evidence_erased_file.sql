-- =============================================================
-- 9.28  Let a prescription image's file be erased
-- -------------------------------------------------------------
-- 9.25 wrote two constraints that contradict each other:
--
--   file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
--   CHECK (kind = 'PRESCRIPTION_IMAGE' AND file_id IS NOT NULL ...)
--
-- Deleting the files row fires SET NULL, which the CHECK then rejects, so the
-- DELETE fails with a confusing shape_check violation naming an UPDATE the
-- caller never issued. In practice that meant a stored prescription image could
-- never be deleted at all — not by a storage sweep, not by the existing
-- deleteFile path, and not to satisfy a PDPA erasure request for health data
-- about an identifiable patient.
--
-- Fix the CHECK rather than the FK, because SET NULL is the behaviour we
-- actually want: erasing the blob must not erase the record that evidence was
-- attached and by whom. `kind = 'PRESCRIPTION_IMAGE' AND file_id IS NULL` now
-- reads as "the image was attached and has since been erased" — a tombstone the
-- audit trail can still explain. Streaming already returns 404 for it, because
-- getEvidenceFileForStreaming() joins on file_id.
--
-- What stays enforced: a text row may never carry a file, an image row may never
-- carry text, and a text row still needs non-blank text.
-- =============================================================

ALTER TABLE bms_pharmacy_clinical_evidence
  DROP CONSTRAINT IF EXISTS bms_pharmacy_clinical_evidence_shape_check;

ALTER TABLE bms_pharmacy_clinical_evidence
  ADD CONSTRAINT bms_pharmacy_clinical_evidence_shape_check CHECK (
    (kind = 'PRESCRIPTION_IMAGE' AND text_value IS NULL)
    OR (kind IN ('PRESCRIPTION_REF', 'COUNSELING_NOTE')
        AND file_id IS NULL
        AND text_value IS NOT NULL
        AND length(btrim(text_value)) > 0)
  );

COMMENT ON COLUMN bms_pharmacy_clinical_evidence.file_id IS
  'The stored prescription image. NULL on a PRESCRIPTION_IMAGE row means the file was erased (PDPA request or storage sweep) while the evidence record is kept for audit.';

-- 9.25 also granted bms_app SELECT on files, which nothing needs: every query
-- that reads files in this module runs on the plain pool as the app role, not
-- inside beginTenantTx (which is what switches to bms_app). files has RLS
-- disabled, so that grant let the deliberately-constrained role read every
-- shop's file rows. Take it back.
REVOKE SELECT ON files FROM bms_app;
