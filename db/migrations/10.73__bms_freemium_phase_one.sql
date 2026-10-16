-- Cloud freemium phase one. Existing products/users are never deleted or disabled.
-- User counts include the owner; product counts retain the existing all-SKU rule.
-- Deploy the schedule-aware application BEFORE applying this migration.
ALTER TABLE bms_plans
  ADD COLUMN IF NOT EXISTS ai_credits_previous_monthly INTEGER,
  ADD COLUMN IF NOT EXISTS ai_credits_effective_at TIMESTAMPTZ;

-- Capture the old Business allowance once and preserve it through this Bangkok
-- calendar month, for all Business shops. Rerunning never postpones the change.
UPDATE bms_plans
SET ai_credits_previous_monthly = COALESCE(ai_credits_previous_monthly, ai_credits_monthly),
    ai_credits_effective_at = COALESCE(ai_credits_effective_at,
      (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') + interval '1 month') AT TIME ZONE 'Asia/Bangkok'),
    ai_credits_monthly = 5000,
    max_ai_messages_month = 5000
WHERE code = 'business';

UPDATE bms_plans
SET price_monthly = CASE code WHEN 'free' THEN 0 WHEN 'pro' THEN 599 ELSE 1990 END,
    max_products = CASE code WHEN 'free' THEN 100 ELSE -1 END,
    max_users = CASE code WHEN 'free' THEN 2 WHEN 'pro' THEN 5 ELSE 20 END,
    max_orders_month = -1
WHERE code IN ('free', 'pro', 'business');

-- No subscription collection, feature gates, branch/device/channel limits or
-- historical usage rewrites. max_channels remains legacy catalogue metadata.
-- ROLLBACK (before deploying older, schedule-unaware application code): restore
-- Business ai_credits_monthly AND max_ai_messages_month from
-- ai_credits_previous_monthly. Leave the additive columns and usage ledger intact.
-- Restore other catalogue limits from a reviewed pre-deployment snapshot if needed.
