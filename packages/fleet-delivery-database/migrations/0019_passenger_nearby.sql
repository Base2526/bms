-- Latest simulator fix only; no real-device collection or location-history authority.
ALTER TABLE fleet_delivery.ride_sandbox_accounts
  ADD COLUMN IF NOT EXISTS location jsonb,
  ADD COLUMN IF NOT EXISTS location_received_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ride_sandbox_location_shape'
    AND conrelid='fleet_delivery.ride_sandbox_accounts'::regclass) THEN
    ALTER TABLE fleet_delivery.ride_sandbox_accounts ADD CONSTRAINT ride_sandbox_location_shape
      CHECK (location IS NULL OR (role='DRIVER' AND location->>'source'='SIMULATOR'
        AND (location->>'lat')::double precision BETWEEN 13 AND 15
        AND (location->>'lng')::double precision BETWEEN 99 AND 102
        AND (location->>'accuracyM')::double precision BETWEEN 0 AND 100));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ride_sandbox_online_location
  ON fleet_delivery.ride_sandbox_accounts (tenant_ref, location_received_at)
  WHERE role='DRIVER' AND online AND location IS NOT NULL;
-- Existing account tenant RLS/grants apply to the new columns. No new role or bypass.
-- ROLLBACK: stop local sandbox, deploy prior app. Retain columns; no destructive rollback.
