-- Recipe composition compiles to the existing leaf BOM; no sale/stock ledger changes.
BEGIN;
ALTER TABLE bms_product_recipes ADD COLUMN IF NOT EXISTS direct_items JSONB;
ALTER TABLE bms_product_recipes ADD COLUMN IF NOT EXISTS sop_steps JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_recipe_definition_json_check'
    AND conrelid='bms_product_recipes'::regclass) THEN
    ALTER TABLE bms_product_recipes ADD CONSTRAINT bms_recipe_definition_json_check CHECK (
      (direct_items IS NULL OR jsonb_typeof(direct_items)='array') AND jsonb_typeof(sop_steps)='array');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS bms_product_recipe_subrecipes (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL,
  child_recipe_id UUID NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (tenant_id, recipe_id, child_recipe_id),
  CHECK (recipe_id <> child_recipe_id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES bms_product_recipes(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, child_recipe_id) REFERENCES bms_product_recipes(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_bms_recipe_subrecipes_child ON bms_product_recipe_subrecipes(tenant_id,child_recipe_id);
ALTER TABLE bms_product_recipe_subrecipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_recipe_subrecipes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_recipe_subrecipes_tenant_isolation ON bms_product_recipe_subrecipes;
CREATE POLICY bms_product_recipe_subrecipes_tenant_isolation ON bms_product_recipe_subrecipes
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id',true),'')::uuid,tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id',true),'')::uuid,tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_recipe_subrecipes TO bms_app;
COMMENT ON COLUMN bms_product_recipes.direct_items IS 'NULL means legacy flat recipe; otherwise author-entered ingredients before pinned subrecipe expansion.';
COMMENT ON COLUMN bms_product_recipes.sop_steps IS 'Ordered staff-authored preparation steps; content edits append a recipe version.';
COMMENT ON TABLE bms_product_recipe_subrecipes IS 'Pinned recipe-version references; qty is child output base units, not batch count. Leaf BOM is materialized in bms_product_recipe_items.';
COMMIT;
-- ROLLBACK: retain columns, references and leaf BOM. Old editors must not overwrite composed
-- definitions. Do not drop evidence or rewrite historical recipes; deploy a compatible reader first.
