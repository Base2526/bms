-- =============================================================
-- 9.79  Board game cafe shop archetype
-- -------------------------------------------------------------
-- Adds board_game_cafe as an onboarding archetype only. The register, product
-- catalog, purchase order and payment paths keep their existing meanings:
-- sellable goods stay Products, timed play belongs to a future session module,
-- and playable board games belong to a future Game Library asset module.
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pending_shop_signups_archetype_check'
  ) THEN
    ALTER TABLE bms_pending_shop_signups
      DROP CONSTRAINT bms_pending_shop_signups_archetype_check;
  END IF;

  ALTER TABLE bms_pending_shop_signups
    ADD CONSTRAINT bms_pending_shop_signups_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
      'pet_supply', 'building_materials', 'restaurant', 'board_game_cafe', 'other'
    ));

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_store_profile_archetype_check'
  ) THEN
    ALTER TABLE bms_store_profile
      DROP CONSTRAINT bms_store_profile_archetype_check;
  END IF;

  ALTER TABLE bms_store_profile
    ADD CONSTRAINT bms_store_profile_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
      'pet_supply', 'building_materials', 'restaurant', 'board_game_cafe', 'other'
    ));
END $$;

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_pending_shop_signups DROP CONSTRAINT IF EXISTS bms_pending_shop_signups_archetype_check;
-- ALTER TABLE bms_pending_shop_signups
--   ADD CONSTRAINT bms_pending_shop_signups_archetype_check
--   CHECK (business_archetype IS NULL OR business_archetype IN (
--     'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
--     'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
--     'pet_supply', 'building_materials', 'restaurant', 'other'
--   ));
-- ALTER TABLE bms_store_profile DROP CONSTRAINT IF EXISTS bms_store_profile_archetype_check;
-- ALTER TABLE bms_store_profile
--   ADD CONSTRAINT bms_store_profile_archetype_check
--   CHECK (business_archetype IS NULL OR business_archetype IN (
--     'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
--     'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
--     'pet_supply', 'building_materials', 'restaurant', 'other'
--   ));
