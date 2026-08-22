-- =============================================================
-- 7.43  Archetype integrity + onboarding state + restock revenue attribution
-- =============================================================

-- Older application builds could write free text before the DB constraint existed.
UPDATE bms_pending_shop_signups
   SET business_archetype = NULL
 WHERE business_archetype IS NOT NULL
   AND business_archetype NOT IN (
     'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
     'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'other'
   );

UPDATE bms_store_profile
   SET business_archetype = NULL
 WHERE business_archetype IS NOT NULL
   AND business_archetype NOT IN (
     'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
     'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'other'
   );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_pending_shop_signups_archetype_check') THEN
    ALTER TABLE bms_pending_shop_signups
      ADD CONSTRAINT bms_pending_shop_signups_archetype_check
      CHECK (business_archetype IS NULL OR business_archetype IN (
        'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
        'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'other'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_store_profile_archetype_check') THEN
    ALTER TABLE bms_store_profile
      ADD CONSTRAINT bms_store_profile_archetype_check
      CHECK (business_archetype IS NULL OR business_archetype IN (
        'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
        'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'other'
      ));
  END IF;
END $$;

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB NOT NULL DEFAULT '{"completed":[],"skipped":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_last_seen_at TIMESTAMPTZ;

ALTER TABLE bms_restock_subscriptions
  ADD COLUMN IF NOT EXISTS resolved_order_id UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recovered_revenue NUMERIC(12,2)
    CHECK (recovered_revenue IS NULL OR recovered_revenue >= 0);

CREATE INDEX IF NOT EXISTS idx_bms_restock_subscriptions_resolved_order
  ON bms_restock_subscriptions (tenant_id, resolved_order_id)
  WHERE resolved_order_id IS NOT NULL;
