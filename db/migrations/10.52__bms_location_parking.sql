-- Basic branch parking facts shared by every shop type; never live occupancy.
BEGIN;
ALTER TABLE bms_locations ADD COLUMN IF NOT EXISTS parking_info JSONB NOT NULL
  DEFAULT '{"status":"UNKNOWN","published":false}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bms_locations'::regclass AND conname = 'bms_locations_parking_info_check') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_parking_info_check CHECK (
      jsonb_typeof(parking_info) = 'object'
      AND parking_info ? 'status' AND parking_info ? 'published'
      AND jsonb_typeof(parking_info->'status') = 'string'
      AND parking_info->>'status' IN ('UNKNOWN', 'AVAILABLE', 'NONE')
      AND jsonb_typeof(parking_info->'published') = 'boolean'
      AND octet_length(parking_info::text) <= 16000
    );
  END IF;
END $$;
COMMENT ON COLUMN bms_locations.parking_info IS
  'Basic branch parking: status, published opt-in, optional total capacities, details and HTTPS map URL. UNKNOWN is not NONE; capacity is not live availability.';
COMMIT;
-- ROLLBACK: ALTER TABLE bms_locations DROP COLUMN IF EXISTS parking_info;
