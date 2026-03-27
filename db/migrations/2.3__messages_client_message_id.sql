ALTER TABLE messages
ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_message_id
ON messages(chat_id, sender_id, client_message_id);
