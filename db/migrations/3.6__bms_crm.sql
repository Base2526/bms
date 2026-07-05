-- =============================================================
-- 3.6  BMS CRM — customers + identities + addresses
-- -------------------------------------------------------------
-- ตาม BUSINESS_RULES: ลูกค้า 1 คนมีได้หลายช่องทาง/หลายที่อยู่,
--   ห้ามลบ (soft delete), matching ผ่าน identity (channel, external_ref)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  deleted_at  TIMESTAMPTZ,                       -- soft delete
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_customers_phone ON bms_customers(phone) WHERE phone IS NOT NULL;

-- map ช่องทาง → ลูกค้า (1 คนหลายช่องทางได้)
CREATE TABLE IF NOT EXISTS bms_customer_identities (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,                    -- line / tiktok / facebook / test
  external_ref TEXT NOT NULL,                    -- user id ของช่องทางนั้น
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_bms_cust_identities_customer ON bms_customer_identities(customer_id);

-- หลายที่อยู่ต่อคน
CREATE TABLE IF NOT EXISTS bms_customer_addresses (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  label        TEXT,                             -- บ้าน / ที่ทำงาน
  address      TEXT NOT NULL,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_cust_addr_customer ON bms_customer_addresses(customer_id);

-- ผูก order → ลูกค้า
ALTER TABLE bms_orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES bms_customers(id);
CREATE INDEX IF NOT EXISTS idx_bms_orders_customer_id ON bms_orders(customer_id);
