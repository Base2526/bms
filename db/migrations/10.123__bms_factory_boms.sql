BEGIN;
-- A factory BOM produces a stocked SKU directly. Each version is immutable except activation.
CREATE TABLE IF NOT EXISTS bms_factory_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  output_sku text NOT NULL,
  output_size text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  output_qty integer NOT NULL CHECK (output_qty > 0),
  active boolean NOT NULL DEFAULT false,
  sop_steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sop_steps) = 'array'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, output_sku, output_size, version),
  FOREIGN KEY (tenant_id, output_sku, output_size)
    REFERENCES bms_product_variants(tenant_id, product_sku, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_factory_boms_active
  ON bms_factory_boms(tenant_id, output_sku, output_size) WHERE active;
CREATE TABLE IF NOT EXISTS bms_factory_bom_items (
  tenant_id uuid NOT NULL,
  bom_id uuid NOT NULL,
  component_sku text NOT NULL,
  component_size text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  PRIMARY KEY (tenant_id, bom_id, component_sku, component_size),
  FOREIGN KEY (tenant_id, bom_id) REFERENCES bms_factory_boms(tenant_id, id),
  FOREIGN KEY (tenant_id, component_sku, component_size)
    REFERENCES bms_product_variants(tenant_id, product_sku, code)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_factory_boms', 'bms_factory_bom_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM bms_app', t);
  END LOOP;
END $$;
GRANT UPDATE(active) ON bms_factory_boms TO bms_app;
ALTER TABLE bms_operation_production ALTER COLUMN recipe_id DROP NOT NULL;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS factory_bom_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_production'::regclass AND conname='bms_operation_production_factory_bom_fk') THEN
    ALTER TABLE bms_operation_production ADD CONSTRAINT bms_operation_production_factory_bom_fk
      FOREIGN KEY (tenant_id, factory_bom_id) REFERENCES bms_factory_boms(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_production'::regclass AND conname='bms_operation_production_source_check') THEN
    ALTER TABLE bms_operation_production ADD CONSTRAINT bms_operation_production_source_check
      CHECK ((recipe_id IS NULL) <> (factory_bom_id IS NULL));
  END IF;
END $$;
COMMIT;
-- ROLLBACK: stop new factory production commands before reverting code; retain BOMs
-- and referenced batches. Do not make recipe_id NOT NULL while factory batches exist.
