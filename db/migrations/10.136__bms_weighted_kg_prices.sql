BEGIN;
-- A gram is the indivisible stock unit. The displayed/priced unit is one kg.
-- Revision rows are append-only except for retiring the current flag.
CREATE TABLE IF NOT EXISTS bms_weighted_kg_prices (
  tenant_id uuid NOT NULL,
  product_sku text NOT NULL,
  size text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  rate_cents bigint NOT NULL CHECK (rate_cents BETWEEN 1 AND 99999999999),
  basis_grams integer NOT NULL DEFAULT 1000 CHECK (basis_grams=1000),
  is_current boolean NOT NULL DEFAULT true,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,product_sku,size,revision_no),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,product_sku,size)
    REFERENCES bms_product_variants(tenant_id,product_sku,code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_weighted_kg_prices_current
  ON bms_weighted_kg_prices(tenant_id,product_sku,size) WHERE is_current;
ALTER TABLE bms_weighted_kg_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_weighted_kg_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_weighted_kg_prices;
CREATE POLICY tenant_isolation ON bms_weighted_kg_prices
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON bms_weighted_kg_prices TO bms_app;
GRANT UPDATE(is_current) ON bms_weighted_kg_prices TO bms_app;
INSERT INTO bms_role_permissions (tenant_id,role_id,permission)
SELECT t.id,r.id,'product.weighted_price.publish' FROM bms_tenants t CROSS JOIN roles r
 WHERE r.name='Manager'
ON CONFLICT (tenant_id,role_id,permission) DO NOTHING;
COMMIT;
-- ROLLBACK: disable new rate publication; preserve rows while sold-line snapshots reference them.
