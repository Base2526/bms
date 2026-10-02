-- Recover a one-use exchange whose HTTP response was lost. Only an exact request
-- id plus the original activation secret can replay. Only token hashes are stored.
BEGIN;
ALTER TABLE bms_retail_local_license_bootstrap_tokens
  ADD COLUMN IF NOT EXISTS redemption_request_id UUID;
COMMIT;
