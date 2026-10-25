-- =============================================================
-- 10.90  Customer-display welcome background
-- -------------------------------------------------------------
-- Optional tenant-owned branding image shown only while the customer display
-- is idle. The existing bms_store_profile RLS policy and bms_app table grants
-- continue to protect this nullable column.
-- =============================================================

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS customer_display_background_url TEXT;

COMMENT ON COLUMN bms_store_profile.customer_display_background_url IS
  'Public tenant-owned image used only behind the idle customer-display welcome screen';

-- ROLLBACK (manual, destructive):
-- ALTER TABLE bms_store_profile DROP COLUMN IF EXISTS customer_display_background_url;
