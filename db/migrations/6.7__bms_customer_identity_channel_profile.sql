-- =============================================================
-- 6.7  BMS CRM — channel profile cache for customer identities
-- -------------------------------------------------------------
-- External chat platforms (LINE OA first) expose display profile
-- metadata such as display name and avatar URL. Store that metadata
-- on the channel identity, not as authoritative CRM customer data, so
-- staff-edited customer records remain the source of truth.
-- =============================================================

ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS picture_url TEXT;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS profile_error_at TIMESTAMPTZ;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS profile_error TEXT;
ALTER TABLE bms_customer_identities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_bms_cust_identities_profile_sync
  ON bms_customer_identities (tenant_id, channel, profile_synced_at);
