CREATE TABLE IF NOT EXISTS scam_phone_unblocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  phone text NOT NULL,
  client_id uuid NOT NULL,
  device_model text,
  os_version text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_phone ON scam_phone_unblocks(phone);
CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_user ON scam_phone_unblocks(user_id);



ALTER TABLE scam_bank_account_reports
ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_sbar_user_created
ON scam_bank_account_reports (user_id, created_at DESC);