-- =============================================================
-- 9.40  Multi-store stock capabilities
-- -------------------------------------------------------------
-- Archetype chooses onboarding defaults only. Authoritative stock behaviour is
-- tenant capability + product policy + an immutable order-item consumption
-- snapshot. Quantities remain integer base units (gram/ml/mm/piece) so existing
-- inventory, lot, reservation, transfer and count invariants stay unchanged.
-- =============================================================

-- ---- 1. New onboarding archetypes (additive) ------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_pending_shop_signups_archetype_check') THEN
    ALTER TABLE bms_pending_shop_signups DROP CONSTRAINT bms_pending_shop_signups_archetype_check;
  END IF;
  ALTER TABLE bms_pending_shop_signups
    ADD CONSTRAINT bms_pending_shop_signups_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
      'pet_supply', 'building_materials', 'restaurant', 'other'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_store_profile_archetype_check') THEN
    ALTER TABLE bms_store_profile DROP CONSTRAINT bms_store_profile_archetype_check;
  END IF;
  ALTER TABLE bms_store_profile
    ADD CONSTRAINT bms_store_profile_archetype_check
    CHECK (business_archetype IS NULL OR business_archetype IN (
      'mini_mart', 'fashion', 'home_kitchen', 'beauty_personal_care', 'food_beverage',
      'gadgets_accessories', 'b2b_wholesale', 'gifts_seasonal', 'pharmacy',
      'pet_supply', 'building_materials', 'restaurant', 'other'
    ));
END $$;

-- ---- 2. Tenant capability overrides --------------------------------
CREATE TABLE IF NOT EXISTS bms_store_capabilities (
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  capability   TEXT NOT NULL CHECK (capability IN (
    'PACK', 'MULTI_BARCODE', 'LOT_TRACKING', 'EXPIRY_TRACKING', 'FEFO',
    'WEIGHTED_PRODUCT', 'UNIT_CONVERSION', 'SERIAL_TRACKING', 'PHARMACY_POLICY',
    'RECIPE', 'MODIFIER', 'KITCHEN_WORKFLOW', 'WASTAGE'
  )),
  enabled      BOOLEAN NOT NULL,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  source       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('PRESET', 'MANUAL')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, capability)
);

COMMENT ON TABLE bms_store_capabilities IS
  'Tenant overrides for stock capabilities. Missing rows inherit the archetype preset; archetype never directly changes stock.';

-- ---- 3. Product-level authoritative stock policy -------------------
CREATE TABLE IF NOT EXISTS bms_product_stock_policies (
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  stock_policy    TEXT NOT NULL DEFAULT 'DIRECT' CHECK (stock_policy IN (
    'DIRECT', 'PACK', 'BUNDLE', 'WEIGHTED', 'RECIPE', 'SERIALIZED'
  )),
  base_unit       TEXT NOT NULL DEFAULT 'PIECE' CHECK (base_unit ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  display_unit    TEXT,
  display_precision SMALLINT NOT NULL DEFAULT 0 CHECK (display_precision BETWEEN 0 AND 6),
  lot_tracking    BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_tracking BOOLEAN NOT NULL DEFAULT FALSE,
  fefo            BOOLEAN NOT NULL DEFAULT FALSE,
  kitchen_station TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_sku),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CHECK (NOT expiry_tracking OR lot_tracking),
  CHECK (NOT fefo OR lot_tracking)
);

COMMENT ON TABLE bms_product_stock_policies IS
  'How one product consumes stock. Integer base units avoid a system-wide decimal inventory migration.';

-- Existing products keep exactly their current behaviour. Pack and bundle are
-- inferred by the resolver from their existing source-of-truth tables.
INSERT INTO bms_product_stock_policies (tenant_id, product_sku, stock_policy)
SELECT tenant_id, sku, CASE WHEN is_bundle THEN 'BUNDLE' ELSE 'DIRECT' END
  FROM bms_products
ON CONFLICT (tenant_id, product_sku) DO NOTHING;

-- ---- 4. Versioned recipes and modifiers -----------------------------
CREATE TABLE IF NOT EXISTS bms_product_recipes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  version         INTEGER NOT NULL CHECK (version > 0),
  output_qty      INTEGER NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  active          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, product_sku, size, version),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_recipes_active
  ON bms_product_recipes (tenant_id, product_sku, size) WHERE active;

CREATE TABLE IF NOT EXISTS bms_product_recipe_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  recipe_id       UUID NOT NULL,
  component_sku   TEXT NOT NULL,
  component_size  TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, component_sku, component_size),
  FOREIGN KEY (tenant_id, recipe_id)
    REFERENCES bms_product_recipes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, component_sku)
    REFERENCES bms_products(tenant_id, sku),
  CHECK (component_sku <> '')
);

CREATE TABLE IF NOT EXISTS bms_product_modifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, product_sku, size, code),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_product_modifier_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  modifier_id     UUID NOT NULL,
  component_sku   TEXT NOT NULL,
  component_size  TEXT NOT NULL,
  qty_delta       INTEGER NOT NULL CHECK (qty_delta <> 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (modifier_id, component_sku, component_size),
  FOREIGN KEY (tenant_id, modifier_id)
    REFERENCES bms_product_modifiers(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, component_sku)
    REFERENCES bms_products(tenant_id, sku)
);

-- ---- 5. Immutable stock-consumption snapshots ----------------------
ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS stock_modifier_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stock_consumption_version INTEGER NOT NULL DEFAULT 1
    CHECK (stock_consumption_version > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_order_items_tenant_id_id
  ON bms_order_items (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_tenant_id_id
  ON bms_orders (tenant_id, id);

CREATE TABLE IF NOT EXISTS bms_order_item_stock_consumption (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_item_id   BIGINT NOT NULL,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  source          TEXT NOT NULL CHECK (source IN (
    'DIRECT', 'PACK', 'BUNDLE', 'WEIGHTED', 'RECIPE', 'MODIFIER'
  )),
  source_ref      TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_item_id, product_sku, size),
  FOREIGN KEY (tenant_id, order_item_id)
    REFERENCES bms_order_items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_order_item_consumption_order_item
  ON bms_order_item_stock_consumption (tenant_id, order_item_id);

-- Snapshot rows win. Legacy orders with no snapshot retain the exact 8.8
-- direct/bundle expansion, so rollout does not reinterpret historical bills.
DROP VIEW IF EXISTS bms_order_stock_lines;
CREATE VIEW bms_order_stock_lines AS
  SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
         c.product_sku, c.size, c.qty
    FROM bms_order_items oi
    JOIN bms_order_item_stock_consumption c
      ON c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         oi.product_sku, oi.size, oi.qty
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
   WHERE p.is_bundle IS NOT TRUE
     AND NOT EXISTS (
       SELECT 1 FROM bms_order_item_stock_consumption c
        WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
     )
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         b.component_sku, b.component_size, (oi.qty * b.qty)::integer
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku AND p.is_bundle
    JOIN bms_product_bundle_items b
      ON b.tenant_id = oi.tenant_id AND b.bundle_sku = oi.product_sku
   WHERE NOT EXISTS (
       SELECT 1 FROM bms_order_item_stock_consumption c
        WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
     );

COMMENT ON VIEW bms_order_stock_lines IS
  'Immutable stock effects per sold line. New rows use 9.40 snapshots; legacy rows retain direct/bundle expansion.';

-- ---- 6. Kitchen and wastage operational ledgers --------------------
CREATE TABLE IF NOT EXISTS bms_kitchen_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL,
  order_item_id   BIGINT NOT NULL,
  station         TEXT,
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'
  )),
  modifier_codes  TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_item_id),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES bms_orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, order_item_id)
    REFERENCES bms_order_items(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_kitchen_tickets_queue
  ON bms_kitchen_tickets (tenant_id, station, status, created_at);

CREATE TABLE IF NOT EXISTS bms_inventory_wastage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  reason          TEXT NOT NULL,
  actor_user_id   UUID REFERENCES users(id),
  order_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES bms_orders(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_bms_inventory_wastage_created
  ON bms_inventory_wastage (tenant_id, location_id, created_at DESC);

-- ---- 7. RLS, grants and revision history ---------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_store_capabilities', 'bms_product_stock_policies', 'bms_product_recipes',
    'bms_product_recipe_items', 'bms_product_modifiers', 'bms_product_modifier_items',
    'bms_order_item_stock_consumption', 'bms_kitchen_tickets', 'bms_inventory_wastage'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_store_capabilities, bms_product_stock_policies, bms_product_recipes,
  bms_product_recipe_items, bms_product_modifiers, bms_product_modifier_items,
  bms_order_item_stock_consumption, bms_kitchen_tickets, bms_inventory_wastage
  TO bms_app;
GRANT SELECT ON bms_order_stock_lines TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

SELECT public.create_revision_trigger('bms_store_capabilities');
SELECT public.create_revision_trigger('bms_product_stock_policies');
SELECT public.create_revision_trigger('bms_product_recipes');
SELECT public.create_revision_trigger('bms_product_recipe_items');
SELECT public.create_revision_trigger('bms_product_modifiers');
SELECT public.create_revision_trigger('bms_product_modifier_items');
