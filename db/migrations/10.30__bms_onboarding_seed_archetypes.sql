-- =============================================================
-- 10.30  Keep onboarding sample-data runs aligned with shop archetypes
-- -------------------------------------------------------------
-- The store-profile constraints were expanded as new archetypes were added,
-- but the resumable sample-seed ledger still accepted only the original 7.44
-- set. A newly provisioned restaurant therefore failed before its first seed
-- step. Keep the ledger capable of recording every currently supported shop
-- archetype; the application remains responsible for validating the value.
-- =============================================================

BEGIN;

ALTER TABLE bms_onboarding_seed_runs
  DROP CONSTRAINT IF EXISTS bms_onboarding_seed_runs_archetype_check;

ALTER TABLE bms_onboarding_seed_runs
  ADD CONSTRAINT bms_onboarding_seed_runs_archetype_check CHECK (
    archetype IS NULL OR archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
      'pet_supply', 'building_materials', 'restaurant', 'board_game_cafe', 'other'
    )
  );

COMMIT;

