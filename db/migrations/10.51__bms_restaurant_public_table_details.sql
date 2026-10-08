-- =============================================================
-- 10.51  Opt-in customer-safe restaurant table details
-- -------------------------------------------------------------
-- A branch may publish area/floor labels and capacity-grouped table
-- counts to customer chat. Existing branches remain private until a
-- restaurant floor manager explicitly enables the projection.
-- =============================================================

BEGIN;

ALTER TABLE bms_locations
  ADD COLUMN IF NOT EXISTS publish_restaurant_table_details BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_locations.publish_restaurant_table_details IS
  'Restaurant-only opt-in for publishing area labels and capacity-grouped table counts; never table ids, codes, checks, occupants or customer data.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_locations DROP COLUMN IF EXISTS publish_restaurant_table_details;
