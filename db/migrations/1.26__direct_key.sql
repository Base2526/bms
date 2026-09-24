-- Direct-message identity. NULL is allowed for group chats; PostgreSQL unique
-- indexes permit multiple NULL values, so one non-partial index covers both
-- group and direct conversations without a duplicate two-pass script.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS direct_key TEXT;

DROP INDEX IF EXISTS chats_direct_key_uq_partial;
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_uq ON chats (direct_key);

-- The base schema already has this primary key. Keep the named index for
-- installations created from an older base schema.
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_uq ON chat_members(chat_id, user_id);
