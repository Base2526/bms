-- =============================================================
-- 7.63  Expand store profile archetype allowlist to include pharmacy
-- =============================================================

UPDATE bms_pending_shop_signups
   SET business_archetype = NULL
 WHERE business_archetype = 'pharmacy';

UPDATE bms_store_profile
   SET business_archetype = NULL
 WHERE business_archetype = 'pharmacy';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_pending_shop_signups_archetype_check') THEN
    ALTER TABLE bms_pending_shop_signups DROP CONSTRAINT bms_pending_shop_signups_archetype_check;
  END IF;
  ALTER TABLE bms_pending_shop_signups
    ADD CONSTRAINT bms_pending_shop_signups_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy', 'other'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_store_profile_archetype_check') THEN
    ALTER TABLE bms_store_profile DROP CONSTRAINT bms_store_profile_archetype_check;
  END IF;
  ALTER TABLE bms_store_profile
    ADD CONSTRAINT bms_store_profile_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy', 'other'
    ));
END $$;
