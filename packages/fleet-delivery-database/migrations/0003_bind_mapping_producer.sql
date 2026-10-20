ALTER TABLE fleet_delivery.integration_mappings
  ADD COLUMN IF NOT EXISTS allowed_producer text;

UPDATE fleet_delivery.integration_mappings
   SET allowed_producer = 'bms'
 WHERE allowed_producer IS NULL;

ALTER TABLE fleet_delivery.integration_mappings
  ALTER COLUMN allowed_producer SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'integration_mappings_allowed_producer_check'
       AND conrelid = 'fleet_delivery.integration_mappings'::regclass
  ) THEN
    ALTER TABLE fleet_delivery.integration_mappings
      ADD CONSTRAINT integration_mappings_allowed_producer_check
      CHECK (allowed_producer IN ('bms', 'fleet-delivery', 'synthetic-test'));
  END IF;
END
$$;
