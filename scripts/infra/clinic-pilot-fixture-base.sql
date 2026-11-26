-- Minimal synthetic dependencies for disposable 10.141-10.143 migration tests.
-- Apply to a fresh local clinic_pilot_test database only; this is not a BMS schema restore.
CREATE ROLE bms_app;
CREATE TABLE bms_tenants (id uuid PRIMARY KEY);
CREATE TABLE users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  name text, email text
);
CREATE TABLE bms_locations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  name text, active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id,id)
);
CREATE TABLE bms_orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  status text NOT NULL DEFAULT 'PENDING',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  shipping_fee numeric(12,2) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id,id)
);
CREATE TABLE bms_products (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id), sku text NOT NULL,
  vat_category text NOT NULL, price numeric(12,2) NOT NULL,
  PRIMARY KEY (tenant_id,sku)
);
CREATE TABLE bms_product_variants (
  tenant_id uuid NOT NULL, product_sku text NOT NULL, code text NOT NULL,
  PRIMARY KEY (tenant_id,product_sku,code),
  FOREIGN KEY (tenant_id,product_sku) REFERENCES bms_products(tenant_id,sku)
);
GRANT SELECT ON bms_locations, users, bms_tenants, bms_orders TO bms_app;
