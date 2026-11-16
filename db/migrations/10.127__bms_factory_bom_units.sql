BEGIN;
-- Pin the unit used to interpret each integer BOM quantity. Older draft BOMs
-- have no trustworthy historical unit and must be revised before new planning.
ALTER TABLE bms_factory_boms ADD COLUMN IF NOT EXISTS output_base_unit text;
ALTER TABLE bms_factory_bom_items ADD COLUMN IF NOT EXISTS component_base_unit text;
UPDATE bms_factory_boms SET active=false
WHERE active AND output_base_unit IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='bms_factory_boms'::regclass
      AND conname='bms_factory_boms_active_unit_check') THEN
    ALTER TABLE bms_factory_boms ADD CONSTRAINT bms_factory_boms_active_unit_check
      CHECK (NOT active OR output_base_unit IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='bms_factory_bom_items'::regclass
      AND conname='bms_factory_bom_items_unit_check') THEN
    ALTER TABLE bms_factory_bom_items ADD CONSTRAINT bms_factory_bom_items_unit_check
      CHECK (component_base_unit IS NOT NULL) NOT VALID;
  END IF;
END $$;
COMMIT;
-- ROLLBACK: retain both unit columns and pinned batches. Never reinterpret an
-- old unitless BOM or reactivate it automatically; revise it after review.
