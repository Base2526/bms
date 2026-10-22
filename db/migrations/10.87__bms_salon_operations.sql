-- 10.87  Salon operations
--
-- A salon appointment is operational state, not an order.  Money continues to flow through the
-- normal POS order/payment/tax transaction.  Service SKUs and package-sale SKUs are ordinary
-- NON_STOCK catalog products; this migration stores scheduling, delivery and entitlement evidence.
--
-- ROLLBACK (only after exporting operational history):
--   DROP TABLE IF EXISTS bms_salon_package_ledger, bms_salon_customer_packages,
--     bms_salon_package_plans, bms_salon_client_profiles, bms_salon_appointment_services,
--     bms_salon_appointments, bms_salon_resources, bms_salon_service_settings CASCADE;

CREATE TABLE IF NOT EXISTS bms_salon_service_settings (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 180),
  online_bookable BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_sku),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_salon_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES bms_locations(id),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('CHAIR','ROOM','BED','EQUIPMENT')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (tenant_id, location_id, name)
);

CREATE TABLE IF NOT EXISTS bms_salon_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES bms_locations(id),
  customer_id UUID NOT NULL REFERENCES bms_customers(id),
  status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN
    ('BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','CANCELLED','NO_SHOW')),
  source TEXT NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','ONLINE','CUSTOMER_AI','WALK_IN')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  order_id UUID REFERENCES bms_orders(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_bms_salon_appointments_calendar
  ON bms_salon_appointments (tenant_id, location_id, starts_at, ends_at)
  WHERE status NOT IN ('CANCELLED','NO_SHOW');
CREATE INDEX IF NOT EXISTS idx_bms_salon_appointments_customer
  ON bms_salon_appointments (tenant_id, customer_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS bms_salon_appointment_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  staff_user_id UUID NOT NULL REFERENCES users(id),
  resource_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES bms_salon_appointments(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bms_salon_resources(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_bms_salon_services_staff_calendar
  ON bms_salon_appointment_services (tenant_id, staff_user_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_bms_salon_services_resource_calendar
  ON bms_salon_appointment_services (tenant_id, resource_id, starts_at, ends_at)
  WHERE resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_salon_client_profiles (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  allergy_notes TEXT,
  formula_notes TEXT,
  preference_notes TEXT,
  photo_consent BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS bms_salon_package_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  sale_product_sku TEXT NOT NULL,
  service_product_sku TEXT NOT NULL,
  total_uses INTEGER NOT NULL CHECK (total_uses BETWEEN 1 AND 1000),
  validity_days INTEGER NOT NULL CHECK (validity_days BETWEEN 1 AND 3650),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_product_sku) REFERENCES bms_products(tenant_id, sku),
  FOREIGN KEY (tenant_id, service_product_sku) REFERENCES bms_products(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS bms_salon_customer_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES bms_customers(id),
  source_order_id UUID NOT NULL REFERENCES bms_orders(id),
  source_order_item_id BIGINT NOT NULL REFERENCES bms_order_items(id),
  total_uses INTEGER NOT NULL CHECK (total_uses > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED','VOID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_order_item_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES bms_salon_package_plans(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bms_salon_package_ledger (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_package_id UUID NOT NULL,
  appointment_service_id UUID,
  delta_uses INTEGER NOT NULL CHECK (delta_uses <> 0),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 240),
  actor_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_package_id) REFERENCES bms_salon_customer_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_service_id) REFERENCES bms_salon_appointment_services(tenant_id, id),
  UNIQUE (tenant_id, appointment_service_id)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_salon_service_settings','bms_salon_resources','bms_salon_appointments',
    'bms_salon_appointment_services','bms_salon_client_profiles','bms_salon_package_plans',
    'bms_salon_customer_packages','bms_salon_package_ledger'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id)) WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id))', t || '_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bms_app', t);
  END LOOP;
  -- Package usage is immutable evidence. Corrections are compensating ledger rows.
  REVOKE UPDATE, DELETE ON bms_salon_package_ledger FROM bms_app;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

SELECT public.create_revision_trigger('bms_salon_service_settings');
SELECT public.create_revision_trigger('bms_salon_resources');
SELECT public.create_revision_trigger('bms_salon_appointments');
SELECT public.create_revision_trigger('bms_salon_appointment_services');
SELECT public.create_revision_trigger('bms_salon_client_profiles');
SELECT public.create_revision_trigger('bms_salon_package_plans');
SELECT public.create_revision_trigger('bms_salon_customer_packages');

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
CROSS JOIN (VALUES ('salon.view'),('salon.manage'),('salon.client_notes.manage'),('salon.package.manage')) p(permission)
WHERE r.name = 'Manager'
ON CONFLICT DO NOTHING;
