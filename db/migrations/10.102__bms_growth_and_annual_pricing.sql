-- Add the mid-market Growth package and explicit annual catalogue prices.
-- Annual prices are quote/catalogue evidence only; this does not add recurring billing.
BEGIN;

ALTER TABLE bms_plans
  ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bms_plans'::regclass
      AND conname = 'bms_plans_price_yearly_nonnegative'
  ) THEN
    ALTER TABLE bms_plans
      ADD CONSTRAINT bms_plans_price_yearly_nonnegative CHECK (price_yearly >= 0);
  END IF;
END $$;

UPDATE bms_plans
SET price_yearly = CASE code
      WHEN 'free' THEN 0
      WHEN 'pro' THEN 9900
      WHEN 'business' THEN 49000
      WHEN 'enterprise' THEN 329000
    END,
    sort = CASE code
      WHEN 'free' THEN 1
      WHEN 'pro' THEN 2
      WHEN 'business' THEN 4
      WHEN 'enterprise' THEN 5
    END,
    version = version + 1,
    updated_at = now()
WHERE code IN ('free','pro','business','enterprise')
  AND (price_yearly, sort) IS DISTINCT FROM
      (CASE code WHEN 'free' THEN 0 WHEN 'pro' THEN 9900 WHEN 'business' THEN 49000 ELSE 329000 END,
       CASE code WHEN 'free' THEN 1 WHEN 'pro' THEN 2 WHEN 'business' THEN 4 ELSE 5 END);

INSERT INTO bms_plans (
  code, name, price_monthly, price_yearly, max_products, max_channels, max_orders_month, sort,
  max_users, max_ai_messages_month, ai_credits_monthly, max_branches, max_devices,
  feature_keys, version, updated_at
) VALUES (
  'growth', 'Growth', 1990, 19900, 15000, 5, -1, 3,
  15, 2500, 2500, 3, 6,
  ARRAY['REPORT_SCHEDULE']::text[], 1, now()
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    price_monthly = EXCLUDED.price_monthly,
    price_yearly = EXCLUDED.price_yearly,
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
    version = CASE WHEN (bms_plans.name, bms_plans.price_monthly, bms_plans.price_yearly,
      bms_plans.max_products, bms_plans.max_channels, bms_plans.max_orders_month, bms_plans.sort,
      bms_plans.max_users, bms_plans.max_ai_messages_month, bms_plans.ai_credits_monthly,
      bms_plans.max_branches, bms_plans.max_devices, bms_plans.feature_keys) IS DISTINCT FROM
      (EXCLUDED.name, EXCLUDED.price_monthly, EXCLUDED.price_yearly, EXCLUDED.max_products,
       EXCLUDED.max_channels, EXCLUDED.max_orders_month, EXCLUDED.sort, EXCLUDED.max_users,
       EXCLUDED.max_ai_messages_month, EXCLUDED.ai_credits_monthly, EXCLUDED.max_branches,
       EXCLUDED.max_devices, EXCLUDED.feature_keys)
      THEN bms_plans.version + 1 ELSE bms_plans.version END,
    updated_at = CASE WHEN (bms_plans.name, bms_plans.price_monthly, bms_plans.price_yearly,
      bms_plans.max_products, bms_plans.max_channels, bms_plans.max_orders_month, bms_plans.sort,
      bms_plans.max_users, bms_plans.max_ai_messages_month, bms_plans.ai_credits_monthly,
      bms_plans.max_branches, bms_plans.max_devices, bms_plans.feature_keys) IS DISTINCT FROM
      (EXCLUDED.name, EXCLUDED.price_monthly, EXCLUDED.price_yearly, EXCLUDED.max_products,
       EXCLUDED.max_channels, EXCLUDED.max_orders_month, EXCLUDED.sort, EXCLUDED.max_users,
       EXCLUDED.max_ai_messages_month, EXCLUDED.ai_credits_monthly, EXCLUDED.max_branches,
       EXCLUDED.max_devices, EXCLUDED.feature_keys)
      THEN now() ELSE bms_plans.updated_at END;

-- Keep the old signature unavailable to the app after the code deploy. The new overload
-- updates monthly and annual prices atomically under the existing preview/version workflow.
REVOKE EXECUTE ON FUNCTION public.update_bms_plan_catalog(
  text,integer,text,numeric,integer,integer,integer,integer,integer,integer,integer,integer,text[]
) FROM bms_app;

CREATE OR REPLACE FUNCTION public.update_bms_plan_catalog(
  p_code text,p_expected_version integer,p_name text,p_price numeric,p_price_yearly numeric,
  p_max_products integer,p_max_channels integer,p_max_orders integer,p_max_users integer,
  p_max_branches integer,p_max_devices integer,p_max_ai integer,p_ai_credits integer,p_features text[]
) RETURNS SETOF bms_plans LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_price < 0 OR p_price_yearly < 0 THEN RAISE EXCEPTION 'PLAN_PRICE_INVALID'; END IF;
  IF (p_price = 0) <> (p_price_yearly = 0) OR p_price_yearly > p_price * 12 THEN
    RAISE EXCEPTION 'PLAN_ANNUAL_PRICE_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(COALESCE(p_features,ARRAY[]::text[])) AS feature(feature_key)
    WHERE feature_key NOT IN ('REPORT_SCHEDULE','RETENTION_ENGINE')) THEN
    RAISE EXCEPTION 'PLAN_FEATURE_INVALID';
  END IF;
  RETURN QUERY UPDATE bms_plans SET name=p_name,price_monthly=p_price,price_yearly=p_price_yearly,
    max_products=p_max_products,max_channels=p_max_channels,max_orders_month=p_max_orders,
    max_users=p_max_users,max_branches=p_max_branches,max_devices=p_max_devices,
    max_ai_messages_month=p_max_ai,ai_credits_monthly=p_ai_credits,
    feature_keys=COALESCE(p_features,ARRAY[]::text[]),version=version+1,updated_at=now()
   WHERE code=p_code AND version=p_expected_version RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.update_bms_plan_catalog(
  text,integer,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_bms_plan_catalog(
  text,integer,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,text[]
) TO bms_app;

COMMENT ON COLUMN bms_plans.price_yearly IS
  'Published annual catalogue price in THB; quote evidence only, not proof of payment or recurring billing.';

COMMIT;

-- ROLLBACK: deploy the previous application first, then revoke the new function overload.
-- Keep price_yearly and Growth once referenced by a tenant; restore catalogue values by forward migration.
