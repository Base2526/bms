-- =============================================================
-- 7.80  Auth hardening: invalidate stale admin sessions + hash reset tokens
-- =============================================================

-- Increment this value whenever an admin's role or password changes. Admin
-- JWTs carry the value observed at login, so an old token becomes invalid on
-- the next request without requiring a Redis scan by user id.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_session_version BIGINT NOT NULL DEFAULT 0;

-- Password-reset bearer tokens must not be recoverable from a database dump.
-- Backfill existing rows first so reset links issued immediately before this
-- migration continue to work until their normal expiry.
ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

UPDATE password_reset_tokens
   SET token_hash = encode(digest(token, 'sha256'), 'hex')
 WHERE token_hash IS NULL
   AND token IS NOT NULL;

ALTER TABLE password_reset_tokens
  ALTER COLUMN token_hash SET NOT NULL,
  ALTER COLUMN token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_tokens_token_hash
  ON password_reset_tokens(token_hash);
