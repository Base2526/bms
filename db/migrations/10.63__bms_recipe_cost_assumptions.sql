-- Planning assumptions only: no historical backfill, stock, payment or expense changes.
BEGIN;
ALTER TABLE bms_product_recipes ADD COLUMN IF NOT EXISTS cost_assumptions JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_recipe_cost_assumptions_check'
    AND conrelid='bms_product_recipes'::regclass) THEN
    ALTER TABLE bms_product_recipes ADD CONSTRAINT bms_recipe_cost_assumptions_check
      CHECK (cost_assumptions IS NULL OR jsonb_typeof(cost_assumptions)='object');
  END IF;
END $$;
COMMENT ON COLUMN bms_product_recipes.cost_assumptions IS
  'Versioned whole-batch planning assumptions including subrecipe preparation: labor person-minutes/THB per hour, electricity kWh/THB per kWh, gas kg/THB per kg, each with staff source. NULL means unknown. Not actual COGS.';
-- Existing recipe table RLS and table-level bms_app grants cover this column. No new table/trigger.
COMMIT;
-- ROLLBACK: deploy a compatible reader first and retain this evidence column; do not erase versions.
