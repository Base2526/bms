-- =============================================================
-- 5.0  BMS SaaS — แพ็กเกจ (plans) + quota
-- -------------------------------------------------------------
-- tenant.plan (text อยู่แล้ว) อ้าง code ของ bms_plans
-- limit = -1 หมายถึงไม่จำกัด
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_plans (
  code             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  price_monthly    NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_products     INTEGER NOT NULL DEFAULT -1,
  max_channels     INTEGER NOT NULL DEFAULT -1,
  max_orders_month INTEGER NOT NULL DEFAULT -1,
  sort             INTEGER NOT NULL DEFAULT 0
);

INSERT INTO bms_plans (code, name, price_monthly, max_products, max_channels, max_orders_month, sort) VALUES
  ('free',     'Free',     0,     5,  1,   100, 1),
  ('pro',      'Pro',      590,  100,  3,  5000, 2),
  ('business', 'Business', 1990,  -1, -1,    -1, 3)
ON CONFLICT (code) DO NOTHING;

-- ให้ tenant ที่มีอยู่เป็น free
UPDATE bms_tenants SET plan = 'free' WHERE plan IS NULL OR plan NOT IN ('free','pro','business');
