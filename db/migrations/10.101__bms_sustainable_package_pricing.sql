-- Sustainable Cloud package catalogue. Keep only limits the application can enforce today.
-- Orders remain unlimited because checkout/POS has no package admission gate for transaction volume.
-- Existing resources are never deleted or disabled; normal quota checks block additions only.
BEGIN;

UPDATE bms_plans
SET price_monthly = CASE code
      WHEN 'free' THEN 0
      WHEN 'pro' THEN 990
      WHEN 'business' THEN 4900
    END,
    max_products = CASE code
      WHEN 'free' THEN 100
      WHEN 'pro' THEN 5000
      WHEN 'business' THEN 50000
    END,
    max_channels = CASE code
      WHEN 'free' THEN 1
      WHEN 'pro' THEN 3
      WHEN 'business' THEN 10
    END,
    max_orders_month = -1,
    max_users = CASE code
      WHEN 'free' THEN 2
      WHEN 'pro' THEN 5
      WHEN 'business' THEN 40
    END,
    max_branches = CASE code
      WHEN 'free' THEN 1
      WHEN 'pro' THEN 1
      WHEN 'business' THEN 5
    END,
    max_devices = CASE code
      WHEN 'free' THEN 1
      WHEN 'pro' THEN 3
      WHEN 'business' THEN 10
    END,
    max_ai_messages_month = CASE code
      WHEN 'free' THEN 100
      WHEN 'pro' THEN 1000
      WHEN 'business' THEN 5000
    END,
    ai_credits_monthly = CASE code
      WHEN 'free' THEN 100
      WHEN 'pro' THEN 1000
      WHEN 'business' THEN 5000
    END,
    feature_keys = CASE code
      WHEN 'free' THEN ARRAY[]::text[]
      WHEN 'pro' THEN ARRAY['REPORT_SCHEDULE']::text[]
      WHEN 'business' THEN ARRAY['REPORT_SCHEDULE','RETENTION_ENGINE']::text[]
    END,
    version = version + 1,
    updated_at = now()
WHERE code IN ('free','pro','business')
  AND (price_monthly, max_products, max_channels, max_orders_month, max_users,
       max_branches, max_devices, max_ai_messages_month, ai_credits_monthly, feature_keys)
      IS DISTINCT FROM
      (CASE code WHEN 'free' THEN 0 WHEN 'pro' THEN 990 ELSE 4900 END,
       CASE code WHEN 'free' THEN 100 WHEN 'pro' THEN 5000 ELSE 50000 END,
       CASE code WHEN 'free' THEN 1 WHEN 'pro' THEN 3 ELSE 10 END,
       -1,
       CASE code WHEN 'free' THEN 2 WHEN 'pro' THEN 5 ELSE 40 END,
       CASE code WHEN 'business' THEN 5 ELSE 1 END,
       CASE code WHEN 'free' THEN 1 WHEN 'pro' THEN 3 ELSE 10 END,
       CASE code WHEN 'free' THEN 100 WHEN 'pro' THEN 1000 ELSE 5000 END,
       CASE code WHEN 'free' THEN 100 WHEN 'pro' THEN 1000 ELSE 5000 END,
       CASE code WHEN 'free' THEN ARRAY[]::text[] WHEN 'pro' THEN ARRAY['REPORT_SCHEDULE']::text[]
         ELSE ARRAY['REPORT_SCHEDULE','RETENTION_ENGINE']::text[] END);

INSERT INTO bms_plans (
  code, name, price_monthly, max_products, max_channels, max_orders_month, sort,
  max_users, max_ai_messages_month, ai_credits_monthly, max_branches, max_devices,
  feature_keys, version, updated_at
) VALUES (
  'enterprise', 'Enterprise Factory', 29900, 200000, 20, -1, 4,
  150, 10000, 10000, 10, 50,
  ARRAY['REPORT_SCHEDULE','RETENTION_ENGINE']::text[], 1, now()
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    price_monthly = EXCLUDED.price_monthly,
    max_products = EXCLUDED.max_products,
    max_channels = EXCLUDED.max_channels,
    max_orders_month = EXCLUDED.max_orders_month,
    sort = EXCLUDED.sort,
    max_users = EXCLUDED.max_users,
    max_ai_messages_month = EXCLUDED.max_ai_messages_month,
    ai_credits_monthly = EXCLUDED.ai_credits_monthly,
    max_branches = EXCLUDED.max_branches,
    max_devices = EXCLUDED.max_devices,
    feature_keys = EXCLUDED.feature_keys,
    version = CASE WHEN (bms_plans.name, bms_plans.price_monthly, bms_plans.max_products,
      bms_plans.max_channels, bms_plans.max_orders_month, bms_plans.sort, bms_plans.max_users,
      bms_plans.max_ai_messages_month, bms_plans.ai_credits_monthly, bms_plans.max_branches,
      bms_plans.max_devices, bms_plans.feature_keys) IS DISTINCT FROM
      (EXCLUDED.name, EXCLUDED.price_monthly, EXCLUDED.max_products, EXCLUDED.max_channels,
       EXCLUDED.max_orders_month, EXCLUDED.sort, EXCLUDED.max_users, EXCLUDED.max_ai_messages_month,
       EXCLUDED.ai_credits_monthly, EXCLUDED.max_branches, EXCLUDED.max_devices, EXCLUDED.feature_keys)
      THEN bms_plans.version + 1 ELSE bms_plans.version END,
    updated_at = CASE WHEN (bms_plans.name, bms_plans.price_monthly, bms_plans.max_products,
      bms_plans.max_channels, bms_plans.max_orders_month, bms_plans.sort, bms_plans.max_users,
      bms_plans.max_ai_messages_month, bms_plans.ai_credits_monthly, bms_plans.max_branches,
      bms_plans.max_devices, bms_plans.feature_keys) IS DISTINCT FROM
      (EXCLUDED.name, EXCLUDED.price_monthly, EXCLUDED.max_products, EXCLUDED.max_channels,
       EXCLUDED.max_orders_month, EXCLUDED.sort, EXCLUDED.max_users, EXCLUDED.max_ai_messages_month,
       EXCLUDED.ai_credits_monthly, EXCLUDED.max_branches, EXCLUDED.max_devices, EXCLUDED.feature_keys)
      THEN now() ELSE bms_plans.updated_at END;

COMMENT ON TABLE bms_plans IS
  'Cloud package catalogue. Price is catalogue evidence, not proof of payment; recurring billing is not implemented.';

COMMIT;

-- ROLLBACK: restore reviewed catalogue values with a new forward migration. Do not delete the
-- Enterprise row after tenants have been assigned to it, and never rewrite package history.
