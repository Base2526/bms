-- AI entitlement: monthly points, reset at 00:00 Asia/Bangkok on the first.
-- Update catalog only. Runtime reconciles this month's grant under its row lock,
-- preserving consumed points, bonuses, adjustments and the append-only ledger.
-- Previously recorded UTC-period events keep their original accounting period.
-- Historical cost/reservation evidence is retained; it no longer gates AI access.
UPDATE bms_plans
SET price_monthly = CASE code WHEN 'free' THEN 0 WHEN 'pro' THEN 599 ELSE 1990 END,
    ai_credits_monthly = CASE code WHEN 'free' THEN 100 WHEN 'pro' THEN 1000 ELSE -1 END,
    max_ai_messages_month = CASE code WHEN 'free' THEN 100 WHEN 'pro' THEN 1000 ELSE -1 END
WHERE code IN ('free', 'pro', 'business');
