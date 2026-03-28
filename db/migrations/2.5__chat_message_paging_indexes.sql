BEGIN;

-- Supports keyset and offset pagination in chat message history queries.
CREATE INDEX IF NOT EXISTS idx_messages_chat_created_id_desc
ON messages (chat_id, created_at DESC, id DESC);

COMMIT;
