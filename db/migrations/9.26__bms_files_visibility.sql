-- =============================================================
-- 9.26  files.visibility — stop serving sensitive uploads to anyone
-- -------------------------------------------------------------
-- /api/files/[id] authenticates nothing and files.id is a sequential integer,
-- so every upload in the system was readable by anyone who counted upwards.
-- That is correct for a product photo on the public storefront and wrong for a
-- bank transfer slip, an Inbox attachment, or a generated report.
--
-- The column defaults to 'private' so anything added from now on is protected
-- unless a caller says otherwise — new code fails closed rather than open.
--
-- Existing rows are deliberately flipped to 'public' first. There are thousands
-- of them (product images, avatars, the legacy community chat/post images) and
-- no column that says which were sensitive; making them all private in one step
-- would break working pages with no way to tell what to restore. The rows we CAN
-- identify as sensitive are then set back to private below, which is the actual
-- fix for existing data.
-- =============================================================

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_visibility_check;
ALTER TABLE files
  ADD CONSTRAINT files_visibility_check CHECK (visibility IN ('public', 'private'));

-- Step 1: everything that already exists keeps behaving exactly as it does today.
UPDATE files SET visibility = 'public';

-- Step 2: take back the categories that were never meant to be public.

-- Bank transfer slips carry the payer's name and account number. Only
-- /admin/payment ever renders these; the customer's own checkout page does not.
UPDATE files SET visibility = 'private'
 WHERE id IN (
   SELECT (regexp_match(p.slip_url, '^/api/files/(\d+)'))[1]::int
     FROM bms_payments p
    WHERE p.slip_url ~ '^/api/files/\d+'
 );

-- Generated reports already have their own tenant-checked download route
-- (/api/bms/reports/download/[id]); /api/files was a way around it.
UPDATE files SET visibility = 'private'
 WHERE id IN (SELECT file_id FROM bms_generated_reports WHERE file_id IS NOT NULL);

-- Prescription images (9.25). These were never served through /api/files, but
-- defence in depth: if anything ever links one there it must still refuse.
UPDATE files SET visibility = 'private'
 WHERE id IN (
   SELECT file_id FROM bms_pharmacy_clinical_evidence WHERE file_id IS NOT NULL
 );

CREATE INDEX IF NOT EXISTS idx_files_private
  ON files(id) WHERE visibility = 'private';

COMMENT ON COLUMN files.visibility IS
  'public = served by /api/files/[id] with no session (storefront images, legacy community uploads); private = that route requires an admin session. New rows default to private.';
