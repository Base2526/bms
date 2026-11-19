-- Sourced, variant-specific technical facts. Drafts never reach customer tools.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_product_technical_specs (
  tenant_id uuid NOT NULL,
  product_sku text NOT NULL,
  variant_code text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  length_mm numeric(14,3) CHECK (length_mm > 0),
  width_mm numeric(14,3) CHECK (width_mm > 0),
  diameter_mm numeric(14,3) CHECK (diameter_mm > 0),
  thickness_mm numeric(14,3) CHECK (thickness_mm > 0),
  nominal_weight_g numeric(14,3) CHECK (nominal_weight_g > 0),
  grade text CHECK (grade IS NULL OR length(btrim(grade)) BETWEEN 1 AND 120),
  standard_code text CHECK (standard_code IS NULL OR length(btrim(standard_code)) BETWEEN 1 AND 120),
  usage_limitations text CHECK (usage_limitations IS NULL OR length(btrim(usage_limitations)) BETWEEN 1 AND 1000),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 500),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid NOT NULL REFERENCES users(id),
  published_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (tenant_id,product_sku,variant_code,revision_no),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,product_sku,variant_code)
    REFERENCES bms_product_variants(tenant_id,product_sku,code),
  CHECK (num_nonnulls(length_mm,width_mm,diameter_mm,thickness_mm,nominal_weight_g,
    grade,standard_code,usage_limitations) > 0),
  CHECK ((status='PUBLISHED')=(published_by IS NOT NULL AND published_at IS NOT NULL)
    OR status='SUPERSEDED')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_technical_specs_draft
  ON bms_product_technical_specs(tenant_id,product_sku,variant_code) WHERE status='DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_technical_specs_published
  ON bms_product_technical_specs(tenant_id,product_sku,variant_code) WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_bms_product_technical_specs_search
  ON bms_product_technical_specs(tenant_id,status,product_sku,variant_code);

ALTER TABLE bms_product_technical_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_technical_specs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_product_technical_specs;
CREATE POLICY tenant_isolation ON bms_product_technical_specs
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON bms_product_technical_specs TO bms_app;
GRANT UPDATE(status,published_by,published_at) ON bms_product_technical_specs TO bms_app;

INSERT INTO bms_role_permissions (tenant_id,role_id,permission)
SELECT t.id,r.id,'product.spec.publish' FROM bms_tenants t CROSS JOIN roles r
  WHERE r.name='Manager'
ON CONFLICT (tenant_id,role_id,permission) DO NOTHING;
COMMIT;
-- ROLLBACK: stop edits and reads, retain published revisions as customer-answer evidence.
