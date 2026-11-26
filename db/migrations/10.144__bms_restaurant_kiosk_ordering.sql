-- Customer-facing restaurant kiosk: branch locator and staff-reviewed proposals.
-- The kiosk cannot open a check, reserve stock, send kitchen work or take payment.
CREATE TABLE IF NOT EXISTS bms_restaurant_kiosks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (token_hash),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_kiosks_active_branch
  ON bms_restaurant_kiosks (tenant_id, location_id) WHERE active;

CREATE TABLE IF NOT EXISTS bms_restaurant_kiosk_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  kiosk_id UUID NOT NULL,
  service_mode TEXT NOT NULL CHECK (service_mode IN ('DINE_IN', 'TAKEAWAY')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  check_id UUID,
  reviewed_by UUID REFERENCES users(id),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(btrim(rejection_reason)) BETWEEN 1 AND 300),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kiosk_id, idempotency_key),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, kiosk_id)
    REFERENCES bms_restaurant_kiosks(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, check_id)
    REFERENCES bms_restaurant_checks(tenant_id, location_id, id),
  CHECK (
    (status = 'PENDING' AND check_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
    OR (status = 'ACCEPTED' AND check_id IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
    OR (status = 'REJECTED' AND check_id IS NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL)
    OR (status = 'EXPIRED' AND check_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kiosk_inbox
  ON bms_restaurant_kiosk_submissions (tenant_id, location_id, status, submitted_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_restaurant_kiosks', 'bms_restaurant_kiosk_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
      AND policyname = t || '_tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))$p$,
        t || '_tenant_isolation', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON bms_restaurant_kiosks, bms_restaurant_kiosk_submissions TO bms_app;
SELECT public.create_revision_trigger('bms_restaurant_kiosks');
SELECT public.create_revision_trigger('bms_restaurant_kiosk_submissions');
COMMENT ON TABLE bms_restaurant_kiosks IS 'Rotatable public branch locators for restaurant self-order screens; possession cannot send kitchen work.';
COMMENT ON TABLE bms_restaurant_kiosk_submissions IS 'Structured customer proposals requiring POS device, cashier PIN and pos.sell acceptance.';
