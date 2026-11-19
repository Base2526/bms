BEGIN;
-- A revision is immutable once submitted. Quotes never reserve stock or move money.
-- QT numbers are shared by revisions; the (tenant, number, revision) key remains unique.
CREATE TABLE IF NOT EXISTS bms_sales_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  root_id uuid NOT NULL,
  supersedes_id uuid,
  quote_no text NOT NULL CHECK (length(quote_no) BETWEEN 8 AND 32),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','SENT','ACCEPTED','CONVERTED','SUPERSEDED','REJECTED')),
  project_name text NOT NULL CHECK (length(btrim(project_name)) BETWEEN 1 AND 200),
  site_address text NOT NULL DEFAULT '' CHECK (length(site_address) <= 1000),
  delivery_terms text NOT NULL CHECK (delivery_terms IN ('PICKUP','DELIVERY')),
  shipping_fee numeric(14,2) CHECK (shipping_fee IS NULL OR shipping_fee >= 0),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  total numeric(14,2) CHECK (total IS NULL OR total >= 0),
  price_basis text NOT NULL DEFAULT 'VAT_INCLUDED' CHECK (price_basis='VAT_INCLUDED'),
  vat_snapshot jsonb,
  expires_at timestamptz NOT NULL,
  prepared_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  acceptance_evidence text,
  order_id uuid,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,quote_no,revision_no),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES bms_customers(tenant_id,id),
  FOREIGN KEY (tenant_id,supersedes_id) REFERENCES bms_sales_quotations(tenant_id,id),
  FOREIGN KEY (tenant_id,order_id) REFERENCES bms_orders(tenant_id,id),
  CHECK ((delivery_terms='PICKUP' AND shipping_fee=0) OR delivery_terms='DELIVERY'),
  CHECK ((shipping_fee IS NULL AND total IS NULL) OR (shipping_fee IS NOT NULL AND total=subtotal+shipping_fee)),
  CHECK ((status='CONVERTED') = (order_id IS NOT NULL)),
  CHECK ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_sales_quotations_current
  ON bms_sales_quotations(tenant_id,root_id) WHERE status <> 'SUPERSEDED';
CREATE INDEX IF NOT EXISTS idx_bms_sales_quotations_workspace
  ON bms_sales_quotations(tenant_id,location_id,created_at DESC,id DESC);
ALTER TABLE bms_sales_quotations ADD COLUMN IF NOT EXISTS acceptance_evidence text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_sales_quotations'::regclass
    AND conname='bms_sales_quotations_acceptance_evidence_check') THEN
    ALTER TABLE bms_sales_quotations ADD CONSTRAINT bms_sales_quotations_acceptance_evidence_check
      CHECK (acceptance_evidence IS NULL OR length(btrim(acceptance_evidence)) BETWEEN 1 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_sales_quotations'::regclass
    AND conname='bms_sales_quotations_accepted_evidence_check') THEN
    ALTER TABLE bms_sales_quotations ADD CONSTRAINT bms_sales_quotations_accepted_evidence_check
      CHECK (status NOT IN ('ACCEPTED','CONVERTED') OR acceptance_evidence IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_sales_quotation_lines (
  tenant_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_sku text NOT NULL,
  size text NOT NULL,
  pack_code text NOT NULL DEFAULT 'BASE',
  pack_qty integer NOT NULL CHECK (pack_qty > 0),
  base_qty integer NOT NULL CHECK (base_qty > 0),
  unit_name text NOT NULL,
  list_unit_price numeric(12,2) NOT NULL CHECK (list_unit_price >= 0),
  agreed_unit_price numeric(12,2) NOT NULL CHECK (agreed_unit_price >= 0),
  line_discount numeric(14,2) NOT NULL CHECK (line_discount >= 0),
  line_amount numeric(14,2) NOT NULL CHECK (line_amount >= 0),
  vat_category text NOT NULL CHECK (vat_category IN ('V','N','UNKNOWN')),
  PRIMARY KEY (tenant_id,quote_id,line_no),
  UNIQUE (tenant_id,quote_id,product_sku,size,pack_code),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES bms_sales_quotations(tenant_id,id),
  FOREIGN KEY (tenant_id,product_sku,size) REFERENCES bms_product_variants(tenant_id,product_sku,code),
  CHECK (base_qty >= pack_qty),
  CHECK (line_amount=agreed_unit_price*pack_qty),
  CHECK (line_discount=(list_unit_price-agreed_unit_price)*pack_qty)
);

ALTER TABLE bms_sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_sales_quotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_sales_quotations;
CREATE POLICY tenant_isolation ON bms_sales_quotations
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
ALTER TABLE bms_sales_quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_sales_quotation_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_sales_quotation_lines;
CREATE POLICY tenant_isolation ON bms_sales_quotation_lines
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_sales_quotations, bms_sales_quotation_lines TO bms_app;
GRANT UPDATE(status,updated_at,approved_by,approved_at,sent_at,accepted_at,acceptance_evidence,order_id,vat_snapshot)
  ON bms_sales_quotations TO bms_app;
-- allowedBranch reads this single flag inside SET LOCAL ROLE bms_app; no password columns.
GRANT SELECT (is_platform_admin) ON users TO bms_app;

INSERT INTO bms_role_permissions (tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','quotation.view'),('Manager','quotation.create'),
  ('Manager','quotation.approve'),('Manager','quotation.send'),
  ('Manager','quotation.accept'),('Manager','quotation.convert')) p(role_name,permission)
  ON p.role_name=r.name
ON CONFLICT (tenant_id,role_id,permission) DO NOTHING;
COMMIT;
-- ROLLBACK: stop quote commands, retain quoted prices and linked order evidence.
-- Do not delete converted quotes or order snapshots.
