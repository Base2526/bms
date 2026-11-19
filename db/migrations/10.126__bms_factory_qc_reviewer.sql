BEGIN;
ALTER TABLE bms_factory_qc_policies ADD COLUMN IF NOT EXISTS reviewer_id text;
GRANT UPDATE(reviewer_id) ON bms_factory_qc_policies TO bms_app;
COMMIT;
-- ROLLBACK: keep the reviewer assignment as evidence; policy writes and
-- production posting must be stopped before reverting application code.
