-- =============================================================
-- 9.51  Product catalog foundation
-- -------------------------------------------------------------
-- Product variants are catalog facts, not positive stock rows.  Sales
-- surfaces are explicit so active ingredients do not leak into customer
-- catalogs.  Restaurant modifier groups express single/multiple-choice
-- rules without trusting the register UI.
-- =============================================================

-- ---- 1. Catalog-level variants -------------------------------------
CREATE TABLE IF NOT EXISTS bms_product_variants (
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku  TEXT NOT NULL,
  code         TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  display_name TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_sku, code),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

COMMENT ON TABLE bms_product_variants IS
  'Catalog variants/serving options independent of branch stock. A recipe menu may have a variant while its own inventory remains zero.';

INSERT INTO bms_product_variants (tenant_id, product_sku, code)
SELECT tenant_id, product_sku, size
FROM (
  SELECT tenant_id, product_sku, size FROM bms_inventory
  UNION
  SELECT tenant_id, product_sku, size FROM bms_product_packs WHERE size IS NOT NULL
  UNION
  SELECT tenant_id, product_sku, size FROM bms_product_recipes
  UNION
  SELECT tenant_id, product_sku, size FROM bms_product_modifiers
) existing
WHERE size IS NOT NULL AND btrim(size) <> ''
ON CONFLICT (tenant_id, product_sku, code) DO NOTHING;

-- A legacy product can exist before any branch stock row or sized pack. Keep it
-- publishable with one neutral catalog option instead of forcing fake stock.
INSERT INTO bms_product_variants (tenant_id, product_sku, code)
SELECT p.tenant_id, p.sku, 'STD'
  FROM bms_products p
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_product_variants variant
    WHERE variant.tenant_id = p.tenant_id AND variant.product_sku = p.sku
 )
ON CONFLICT (tenant_id, product_sku, code) DO NOTHING;

-- Existing write paths can continue inserting inventory/packs/recipes while
-- the catalog variant stays synchronized.  The trigger performs no stock
-- mutation and therefore creates no movement row.
CREATE OR REPLACE FUNCTION bms_ensure_catalog_variant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.size IS NOT NULL AND btrim(NEW.size) <> '' THEN
    INSERT INTO bms_product_variants (tenant_id, product_sku, code)
    VALUES (NEW.tenant_id, NEW.product_sku, NEW.size)
    ON CONFLICT (tenant_id, product_sku, code) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bms_inventory_ensure_variant ON bms_inventory;
CREATE TRIGGER trg_bms_inventory_ensure_variant
BEFORE INSERT ON bms_inventory
FOR EACH ROW EXECUTE FUNCTION bms_ensure_catalog_variant();

DROP TRIGGER IF EXISTS trg_bms_product_packs_ensure_variant ON bms_product_packs;
CREATE TRIGGER trg_bms_product_packs_ensure_variant
BEFORE INSERT ON bms_product_packs
FOR EACH ROW EXECUTE FUNCTION bms_ensure_catalog_variant();

DROP TRIGGER IF EXISTS trg_bms_product_recipes_ensure_variant ON bms_product_recipes;
CREATE TRIGGER trg_bms_product_recipes_ensure_variant
BEFORE INSERT ON bms_product_recipes
FOR EACH ROW EXECUTE FUNCTION bms_ensure_catalog_variant();

DROP TRIGGER IF EXISTS trg_bms_product_modifiers_ensure_variant ON bms_product_modifiers;
CREATE TRIGGER trg_bms_product_modifiers_ensure_variant
BEFORE INSERT ON bms_product_modifiers
FOR EACH ROW EXECUTE FUNCTION bms_ensure_catalog_variant();

-- ---- 2. Explicit sales surfaces ------------------------------------
CREATE TABLE IF NOT EXISTS bms_product_sales_surfaces (
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku  TEXT NOT NULL,
  surface      TEXT NOT NULL CHECK (surface IN (
    'RETAIL_POS', 'RESTAURANT_POS', 'PUBLIC_STOREFRONT', 'CUSTOMER_AI', 'ONLINE_ORDER'
  )),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_sku, surface),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

COMMENT ON TABLE bms_product_sales_surfaces IS
  'Explicit product visibility per operating surface. Product active is lifecycle state, not channel authority.';

-- Preserve retail compatibility for every existing product. An operator may
-- intentionally sell a dual-purpose ingredient at a retail register.
INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
SELECT p.tenant_id, p.sku, 'RETAIL_POS', TRUE
FROM bms_products p
ON CONFLICT (tenant_id, product_sku, surface) DO NOTHING;

-- Customer-facing paths preserve legacy visibility except for restaurant raw
-- materials. An unpriced item (neither product price nor an active base pack
-- price) or an active recipe/modifier component was the
-- pre-9.51 restaurant definition of an ingredient; omitting these surfaces
-- fixes the leak at migration time while staff can explicitly opt a dual-role
-- product back in afterwards.
INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
SELECT p.tenant_id, p.sku, surface, TRUE
FROM bms_products p
LEFT JOIN bms_store_profile profile ON profile.tenant_id = p.tenant_id
CROSS JOIN unnest(ARRAY[
  'PUBLIC_STOREFRONT', 'CUSTOMER_AI', 'ONLINE_ORDER'
]::text[]) AS surface
WHERE COALESCE(profile.business_archetype, '') <> 'restaurant'
   OR (
     -- ราคาขายจริงของหน่วยฐานอยู่ที่ bms_product_packs.price ได้ (9.22/8.1) แล้ว
     -- bms_products.price ค้างที่ 0 — เมนูแบบนั้นถูกต้องและขายอยู่จริง ถ้าเทียบแต่
     -- p.price > 0 การ backfill จะถอดช่องทางขายของมันออกทั้งหมดตอน migrate
     (
       p.price > 0
       OR EXISTS (
         SELECT 1 FROM bms_product_packs base_pack
          WHERE base_pack.tenant_id = p.tenant_id
            AND base_pack.product_sku = p.sku
            AND base_pack.is_base AND base_pack.active
            AND COALESCE(base_pack.price, 0) > 0
       )
     )
     AND NOT EXISTS (
       SELECT 1
       FROM bms_product_recipe_items ri
       JOIN bms_product_recipes r
         ON r.tenant_id = ri.tenant_id AND r.id = ri.recipe_id AND r.active
       WHERE ri.tenant_id = p.tenant_id AND ri.component_sku = p.sku
     )
     AND NOT EXISTS (
       SELECT 1
       FROM bms_product_modifier_items mi
       JOIN bms_product_modifiers m
         ON m.tenant_id = mi.tenant_id AND m.id = mi.modifier_id AND m.active
       WHERE mi.tenant_id = p.tenant_id AND mi.component_sku = p.sku
     )
   )
ON CONFLICT (tenant_id, product_sku, surface) DO NOTHING;

INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
SELECT p.tenant_id, p.sku, 'RESTAURANT_POS', TRUE
FROM bms_products p
JOIN bms_store_profile profile ON profile.tenant_id = p.tenant_id
WHERE profile.business_archetype = 'restaurant'
  -- ราคาขายจริงของหน่วยฐานอยู่ที่ bms_product_packs.price ได้ (9.22/8.1) แล้ว
  -- bms_products.price ค้างที่ 0 — เมนูแบบนั้นถูกต้องและขายอยู่จริง ถ้าเทียบแต่
  -- p.price > 0 การ backfill จะถอดช่องทางขายของมันออกทั้งหมดตอน migrate
  AND (
    p.price > 0
    OR EXISTS (
      SELECT 1 FROM bms_product_packs base_pack
       WHERE base_pack.tenant_id = p.tenant_id
         AND base_pack.product_sku = p.sku
         AND base_pack.is_base AND base_pack.active
         AND COALESCE(base_pack.price, 0) > 0
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM bms_product_recipe_items ri
    JOIN bms_product_recipes r
      ON r.tenant_id = ri.tenant_id AND r.id = ri.recipe_id AND r.active
    WHERE ri.tenant_id = p.tenant_id AND ri.component_sku = p.sku
  )
  AND NOT EXISTS (
    SELECT 1
    FROM bms_product_modifier_items mi
    JOIN bms_product_modifiers m
      ON m.tenant_id = mi.tenant_id AND m.id = mi.modifier_id AND m.active
    WHERE mi.tenant_id = p.tenant_id AND mi.component_sku = p.sku
  )
ON CONFLICT (tenant_id, product_sku, surface) DO NOTHING;

-- ---- 3. Restaurant modifier groups --------------------------------
CREATE TABLE IF NOT EXISTS bms_product_modifier_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku    TEXT NOT NULL,
  size           TEXT NOT NULL,
  code           TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  selection_type TEXT NOT NULL DEFAULT 'MULTIPLE' CHECK (selection_type IN ('SINGLE', 'MULTIPLE')),
  min_select     INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select     INTEGER CHECK (max_select IS NULL OR max_select > 0),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, product_sku, size, code),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CHECK (max_select IS NULL OR min_select <= max_select),
  CHECK (selection_type <> 'SINGLE' OR max_select = 1)
);

ALTER TABLE bms_product_modifiers
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS default_selected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

INSERT INTO bms_product_modifier_groups
  (tenant_id, product_sku, size, code, name, selection_type, min_select, max_select)
SELECT DISTINCT tenant_id, product_sku, size, 'OPTIONS', 'Options', 'MULTIPLE', 0, NULL::integer
FROM bms_product_modifiers
ON CONFLICT (tenant_id, product_sku, size, code) DO NOTHING;

UPDATE bms_product_modifiers m
SET group_id = g.id
FROM bms_product_modifier_groups g
WHERE m.group_id IS NULL
  AND g.tenant_id = m.tenant_id
  AND g.product_sku = m.product_sku
  AND g.size = m.size
  AND g.code = 'OPTIONS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bms_product_modifiers_group_fk'
      AND conrelid = 'bms_product_modifiers'::regclass
  ) THEN
    ALTER TABLE bms_product_modifiers
      ADD CONSTRAINT bms_product_modifiers_group_fk
      FOREIGN KEY (tenant_id, group_id)
      REFERENCES bms_product_modifier_groups(tenant_id, id);
  END IF;
END $$;

ALTER TABLE bms_product_modifiers
  ALTER COLUMN group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_product_variants_active
  ON bms_product_variants (tenant_id, product_sku, sort_order, code) WHERE active;
CREATE INDEX IF NOT EXISTS idx_bms_product_sales_surfaces_enabled
  ON bms_product_sales_surfaces (tenant_id, surface, product_sku) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_bms_product_modifier_groups_product
  ON bms_product_modifier_groups (tenant_id, product_sku, size, sort_order) WHERE active;
CREATE INDEX IF NOT EXISTS idx_bms_product_modifiers_group
  ON bms_product_modifiers (tenant_id, group_id, sort_order) WHERE active;

-- ---- 4. Tenant isolation, grants and revisions ---------------------
ALTER TABLE bms_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_variants_tenant_isolation ON bms_product_variants;
CREATE POLICY bms_product_variants_tenant_isolation ON bms_product_variants
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_product_sales_surfaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_sales_surfaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_sales_surfaces_tenant_isolation ON bms_product_sales_surfaces;
CREATE POLICY bms_product_sales_surfaces_tenant_isolation ON bms_product_sales_surfaces
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_product_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_modifier_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_modifier_groups_tenant_isolation ON bms_product_modifier_groups;
CREATE POLICY bms_product_modifier_groups_tenant_isolation ON bms_product_modifier_groups
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_product_variants, bms_product_sales_surfaces, bms_product_modifier_groups
  TO bms_app;

SELECT public.create_revision_trigger('bms_product_variants');
SELECT public.create_revision_trigger('bms_product_sales_surfaces');
SELECT public.create_revision_trigger('bms_product_modifier_groups');
