-- Phase 1: Location messages (share location via Google Maps link)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type TEXT,
  ADD COLUMN IF NOT EXISTS location_json JSONB;

ALTER TABLE messages
  ALTER COLUMN message_type SET DEFAULT 'TEXT';

-- Backfill legacy rows (best-effort):
-- - LOCATION if location_json exists
-- - AUDIO if audio_file_id exists
-- - IMAGE if message_images exist and message has no text/audio/location
-- - otherwise TEXT
UPDATE messages
SET message_type = CASE
  WHEN location_json IS NOT NULL THEN 'LOCATION'
  WHEN audio_file_id IS NOT NULL THEN 'AUDIO'
  WHEN COALESCE(NULLIF(TRIM(text), ''), '') = ''
       AND EXISTS (SELECT 1 FROM message_images mi WHERE mi.message_id = messages.id)
       THEN 'IMAGE'
  ELSE 'TEXT'
END
WHERE message_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_message_type
  ON messages(chat_id, message_type);
