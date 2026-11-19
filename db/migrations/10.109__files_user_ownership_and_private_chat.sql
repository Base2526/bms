-- 10.109 — Bind personal uploads to a user and close legacy public-file exposure.
--
-- `files.id` is sequential and `/api/files/:id` is intentionally public for
-- storefront/post/avatar images.  Older migrations could not distinguish every
-- legacy upload and therefore backfilled almost every row to public.  This
-- migration adds the missing user owner and reclassifies the categories that
-- can be identified without guessing:
--   * community chat images/audio are private and require chat membership;
--   * key/database/config/script/path-like artifacts are never generic public
--     downloads (release assets keep using their dedicated guarded route).

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS owner_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'files_owner_user_id_fkey'
       AND conrelid = 'files'::regclass
  ) THEN
    ALTER TABLE files
      ADD CONSTRAINT files_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Recover ownership from authoritative community references where possible.
UPDATE files f
   SET owner_user_id = p.author_id
  FROM post_images pi
  JOIN posts p ON p.id = pi.post_id
 WHERE f.id = pi.file_id
   AND p.author_id IS NOT NULL
   AND f.owner_user_id IS NULL;

UPDATE files f
   SET owner_user_id = m.sender_id
  FROM message_images mi
  JOIN messages m ON m.id = mi.message_id
 WHERE f.id = mi.file_id
   AND m.sender_id IS NOT NULL
   AND f.owner_user_id IS NULL;

UPDATE files f
   SET owner_user_id = m.sender_id
  FROM messages m
 WHERE f.id = m.audio_file_id
   AND m.sender_id IS NOT NULL
   AND f.owner_user_id IS NULL;

UPDATE files f
   SET owner_user_id = u.id
  FROM users u
 WHERE u.avatar ~ '^/api/files/[0-9]+([?].*)?$'
   AND f.id = (regexp_match(u.avatar, '^/api/files/([0-9]+)'))[1]::int
   AND f.owner_user_id IS NULL;

-- Chat media is private.  The application checks membership in the referenced
-- chat before streaming it; a mere authenticated session is not sufficient.
UPDATE files
   SET visibility = 'private'
 WHERE id IN (
   SELECT file_id FROM message_images WHERE file_id IS NOT NULL
   UNION
   SELECT audio_file_id FROM messages WHERE audio_file_id IS NOT NULL
 )
   AND visibility IS DISTINCT FROM 'private';

-- Defense in depth for legacy artifacts accidentally imported into the generic
-- file table.  Dedicated release downloads do not use `/api/files/:id`, so
-- making installer rows private here does not affect the supported flow.
UPDATE files
   SET visibility = 'private'
 WHERE deleted_at IS NULL
   AND visibility IS DISTINCT FROM 'private'
   AND EXISTS (
     SELECT 1
       FROM unnest(ARRAY[original_name, filename, relpath]) AS candidate(value)
      WHERE lower(COALESCE(candidate.value, '')) LIKE ANY (ARRAY[
              '%.env', '%.sql', '%.sqlite', '%.sqlite3', '%.db', '%.dump',
              '%.keystore', '%.jks', '%.pem', '%.key', '%.p12', '%.pfx',
              '%.crt', '%.cer', '%.log', '%.bak', '%.sh', '%.ps1', '%.bat',
              '%.cmd', '%.pkg', '%.deb', '%.exe', '%.msi', '%.dmg'
            ])
         OR candidate.value LIKE '%../%'
         OR replace(candidate.value, chr(92), '/') LIKE '%../%'
   );

CREATE INDEX IF NOT EXISTS idx_files_owner_user
  ON files(owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN files.owner_user_id IS
  'User owner derived from the authenticated session or an authoritative community reference; never accepted from request input.';

-- ROLLBACK (only after reverting the application membership/owner checks):
-- DROP INDEX IF EXISTS idx_files_owner_user;
-- ALTER TABLE files DROP CONSTRAINT IF EXISTS files_owner_user_id_fkey;
-- ALTER TABLE files DROP COLUMN IF EXISTS owner_user_id;
