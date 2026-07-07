-- =============================================================
-- 4.0  BMS SaaS Phase 1 — Multi-tenancy foundation (idempotent)
-- -------------------------------------------------------------
-- • bms_tenants (ร้าน/องค์กร) + bms_tenant_channels (creds ต่อร้าน)
-- • เติม tenant_id ทุกตาราง BMS + backfill = default tenant
-- • re-key products/inventory เป็น per-tenant (sku ซ้ำข้ามร้านได้)
-- • unique identity per tenant
-- รันซ้ำได้ปลอดภัย (guard ทุกขั้น)
-- =============================================================

-- ---- tenants ----
CREATE TABLE IF NOT EXISTS bms_tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bms_tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Default Shop', 'default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bms_tenant_channels (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,
  access_token   TEXT,
  channel_secret TEXT,
  extra          JSONB NOT NULL DEFAULT '{}',
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel)
);

-- ---- เติม tenant_id (nullable ก่อน) + backfill + NOT NULL + FK ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_products','bms_inventory','bms_orders','bms_order_items',
                           'bms_stock_movements','bms_customers','bms_customer_identities','bms_customer_addresses']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID', t);
    EXECUTE format($f$UPDATE %I SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL$f$, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t||'_tenant_fk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES bms_tenants(id)', t, t||'_tenant_fk');
    END IF;
  END LOOP;
END $$;

-- ---- drop FKs เดิมที่อ้าง products(sku) / inventory PK ----
ALTER TABLE bms_inventory       DROP CONSTRAINT IF EXISTS bms_inventory_product_sku_fkey;
ALTER TABLE bms_order_items     DROP CONSTRAINT IF EXISTS bms_order_items_product_sku_fkey;
ALTER TABLE bms_order_items     DROP CONSTRAINT IF EXISTS bms_order_items_product_sku_size_fkey;
ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_product_sku_fkey;

-- ---- re-key products: sku → (tenant_id, sku) ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_products'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) LIKE '%tenant_id%'
  ) THEN
    ALTER TABLE bms_products DROP CONSTRAINT bms_products_pkey;
    ALTER TABLE bms_products ADD PRIMARY KEY (tenant_id, sku);
  END IF;
END $$;

-- ---- re-key inventory ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_inventory'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) LIKE '%tenant_id%'
  ) THEN
    ALTER TABLE bms_inventory DROP CONSTRAINT bms_inventory_pkey;
    ALTER TABLE bms_inventory ADD PRIMARY KEY (tenant_id, product_sku, size);
  END IF;
END $$;

-- ---- (re)create tenant-scoped FKs ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_inventory_product_fk') THEN
    ALTER TABLE bms_inventory ADD CONSTRAINT bms_inventory_product_fk
      FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_order_items_product_fk') THEN
    ALTER TABLE bms_order_items ADD CONSTRAINT bms_order_items_product_fk
      FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_order_items_inv_fk') THEN
    ALTER TABLE bms_order_items ADD CONSTRAINT bms_order_items_inv_fk
      FOREIGN KEY (tenant_id, product_sku, size) REFERENCES bms_inventory(tenant_id, product_sku, size);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_stock_movements_product_fk') THEN
    ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_product_fk
      FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku);
  END IF;
END $$;

-- ---- identity unique per tenant ----
ALTER TABLE bms_customer_identities DROP CONSTRAINT IF EXISTS bms_customer_identities_channel_external_ref_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_cust_identities_uq') THEN
    ALTER TABLE bms_customer_identities ADD CONSTRAINT bms_cust_identities_uq
      UNIQUE (tenant_id, channel, external_ref);
  END IF;
END $$;

-- ---- indexes ----
CREATE INDEX IF NOT EXISTS idx_bms_products_tenant   ON bms_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant     ON bms_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bms_customers_tenant  ON bms_customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bms_movements_tenant  ON bms_stock_movements(tenant_id, product_sku);
