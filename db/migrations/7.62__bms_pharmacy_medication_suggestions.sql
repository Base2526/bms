-- =============================================================
-- 7.62  AI Pharmacy Intake Assistant — AI medication suggestions (pharmacist-only)
-- -------------------------------------------------------------
-- New, deliberately separate capability from the base module (which only
-- lets AI extract/summarize, never suggest a drug). AI may now suggest
-- specific drug/strength/dosage candidates, but ONLY as a draft a pharmacist
-- reviews — never sent to the customer directly, never auto-applied to the
-- case's pharmacist_decision_notes/approval text. See
-- lib/bms/pharmacy/README.md § AI medication suggestions for the full
-- design and risk discussion (decided explicitly with the user — this is a
-- deliberate scope expansion beyond the module's original "AI never
-- recommends a drug" premise, gated tightly to pharmacist-only visibility).
-- =============================================================

ALTER TABLE bms_pharmacy_assessments
  ADD COLUMN IF NOT EXISTS medication_suggestions JSONB NOT NULL DEFAULT '[]';
