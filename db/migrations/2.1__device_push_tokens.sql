-- Device push tokens (FCM)
-- Stores per-device tokens for push notifications (Android first; extendable).

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- e.g. 'android'
  fcm_token TEXT NOT NULL,
  device_id TEXT,
  app_version TEXT,
  locale TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT device_push_tokens_unique_token UNIQUE (fcm_token)
);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_active_idx
  ON device_push_tokens (user_id, is_active);

CREATE INDEX IF NOT EXISTS device_push_tokens_platform_idx
  ON device_push_tokens (platform);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at_device_push_tokens()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_push_tokens_updated_at ON device_push_tokens;
CREATE TRIGGER trg_device_push_tokens_updated_at
BEFORE UPDATE ON device_push_tokens
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_device_push_tokens();
