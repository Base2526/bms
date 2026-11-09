-- =============================================================
-- 10.113 — Pickup queue experience settings and customer-display promos
-- -------------------------------------------------------------
-- Adds presentation policy only. Money, order, stock, kitchen and audit authority remain in the
-- existing services. Queue prefix is snapshotted on each issued number so changing the branch
-- setting never renames a number a customer is already holding.
-- =============================================================

BEGIN;

ALTER TABLE bms_locations
  ADD COLUMN IF NOT EXISTS pickup_queue_prefix TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pickup_queue_start_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pickup_queue_spotlight_seconds INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS pickup_queue_voice_mode TEXT NOT NULL DEFAULT 'AI_STUDIO',
  ADD COLUMN IF NOT EXISTS pickup_queue_voice_language TEXT NOT NULL DEFAULT 'th',
  ADD COLUMN IF NOT EXISTS pickup_queue_voice_repeat INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pickup_queue_voice_volume INTEGER NOT NULL DEFAULT 80;

ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_prefix_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_prefix_check
  CHECK (pickup_queue_prefix ~ '^[A-Z]?$');
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_start_no_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_start_no_check
  CHECK (pickup_queue_start_no BETWEEN 1 AND 9999);
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_spotlight_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_spotlight_check
  CHECK (pickup_queue_spotlight_seconds BETWEEN 5 AND 60);
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_voice_mode_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_voice_mode_check
  CHECK (pickup_queue_voice_mode IN ('AI_STUDIO','VOICE_CHIME','CHIME','OFF'));
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_voice_language_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_voice_language_check
  CHECK (pickup_queue_voice_language IN ('th','en'));
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_voice_repeat_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_voice_repeat_check
  CHECK (pickup_queue_voice_repeat BETWEEN 1 AND 3);
ALTER TABLE bms_locations DROP CONSTRAINT IF EXISTS bms_locations_pickup_queue_voice_volume_check;
ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_voice_volume_check
  CHECK (pickup_queue_voice_volume BETWEEN 0 AND 100);

ALTER TABLE bms_pickup_queue
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE bms_pickup_queue DROP CONSTRAINT IF EXISTS bms_pickup_queue_prefix_check;
ALTER TABLE bms_pickup_queue ADD CONSTRAINT bms_pickup_queue_prefix_check
  CHECK (queue_prefix ~ '^[A-Z]?$');

COMMENT ON COLUMN bms_pickup_queue.queue_prefix IS
  'Branch queue prefix snapshotted when this committed sale receives its number.';

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS customer_display_promo_slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_display_promo_interval_seconds INTEGER NOT NULL DEFAULT 8;

ALTER TABLE bms_store_profile DROP CONSTRAINT IF EXISTS bms_store_profile_customer_display_promos_check;
ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_customer_display_promos_check
  CHECK (jsonb_typeof(customer_display_promo_slides) = 'array'
    AND jsonb_array_length(customer_display_promo_slides) <= 8);
ALTER TABLE bms_store_profile DROP CONSTRAINT IF EXISTS bms_store_profile_customer_display_promo_interval_check;
ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_customer_display_promo_interval_check
  CHECK (customer_display_promo_interval_seconds BETWEEN 4 AND 30);

COMMENT ON COLUMN bms_store_profile.customer_display_promo_slides IS
  'Up to eight validated public tenant-owned image URLs shown only while the customer display is idle.';
COMMENT ON COLUMN bms_store_profile.customer_display_promo_interval_seconds IS
  'Seconds per idle-only customer display promo slide.';

COMMIT;

-- ROLLBACK (manual, destructive):
-- ALTER TABLE bms_store_profile DROP COLUMN customer_display_promo_interval_seconds,
--   DROP COLUMN customer_display_promo_slides;
-- ALTER TABLE bms_pickup_queue DROP COLUMN queue_prefix;
-- ALTER TABLE bms_locations DROP COLUMN pickup_queue_voice_volume,
--   DROP COLUMN pickup_queue_voice_repeat, DROP COLUMN pickup_queue_voice_language,
--   DROP COLUMN pickup_queue_voice_mode, DROP COLUMN pickup_queue_spotlight_seconds,
--   DROP COLUMN pickup_queue_start_no, DROP COLUMN pickup_queue_prefix;

