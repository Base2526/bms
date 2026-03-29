-- Voice message / audio attachment support on chat messages

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS audio_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_mime TEXT,
  ADD COLUMN IF NOT EXISTS audio_duration_sec INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_chat_audio_file
  ON messages(chat_id, audio_file_id);
