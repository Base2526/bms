-- =============================================================
-- 7.42  Shop archetype from signup -> pending signup + store profile
-- =============================================================

ALTER TABLE bms_pending_shop_signups
  ADD COLUMN IF NOT EXISTS business_archetype TEXT;

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS business_archetype TEXT;
