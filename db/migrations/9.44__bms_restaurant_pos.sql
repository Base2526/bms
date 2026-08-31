-- =============================================================
-- 9.44  Restaurant POS: floor, open checks and kitchen rounds
-- -------------------------------------------------------------
-- Restaurant service state is intentionally separate from the retail POS
-- cart.  A check can stay open across several kitchen rounds, while the final
-- payment still becomes one normal POS order so stock, tax and drawer rules
-- continue to have a single source of truth.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_restaurant_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, name),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_restaurant_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  area_id     UUID NOT NULL,
  code        TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 30),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  seats       INTEGER NOT NULL DEFAULT 2 CHECK (seats BETWEEN 1 AND 100),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  blocked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, code),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, area_id)
    REFERENCES bms_restaurant_areas(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_restaurant_checks (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id                UUID NOT NULL,
  table_id                   UUID NOT NULL,
  pos_device_id              UUID NOT NULL REFERENCES bms_pos_devices(id),
  pos_shift_id               UUID NOT NULL REFERENCES bms_pos_shifts(id),
  status                     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'CLOSING', 'PAID', 'CANCELLED'
  )),
  guest_count                INTEGER NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 500),
  note                       TEXT CHECK (note IS NULL OR length(note) <= 500),
  opened_by                  UUID NOT NULL REFERENCES users(id),
  closed_by                  UUID REFERENCES users(id),
  version                    INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  reserved_version           INTEGER CHECK (reserved_version IS NULL OR reserved_version >= 0),
  current_order_id           UUID,
  settlement_idempotency_key TEXT,
  amount_due                 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  opened_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                  TIMESTAMPTZ,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, table_id)
    REFERENCES bms_restaurant_tables(tenant_id, id),
  CHECK ((status IN ('PAID', 'CANCELLED')) = (closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_checks_open_table
  ON bms_restaurant_checks (tenant_id, table_id)
  WHERE status IN ('OPEN', 'CLOSING');
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_checks_shift
  ON bms_restaurant_checks (tenant_id, pos_shift_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS bms_restaurant_check_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  check_id        UUID NOT NULL,
  product_sku     TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  size            TEXT NOT NULL,
  pack_qty        INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty > 0),
  pack_code       TEXT,
  unit_name       TEXT,
  base_qty        INTEGER CHECK (base_qty IS NULL OR base_qty > 0),
  pack_price      NUMERIC(12,2) CHECK (pack_price IS NULL OR pack_price >= 0),
  modifier_codes  TEXT[] NOT NULL DEFAULT '{}',
  modifier_names  TEXT[] NOT NULL DEFAULT '{}',
  kitchen_note    TEXT CHECK (kitchen_note IS NULL OR length(kitchen_note) <= 300),
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'SENT', 'CANCELLED')),
  round_no        INTEGER CHECK (round_no IS NULL OR round_no > 0),
  added_by        UUID NOT NULL REFERENCES users(id),
  sent_by         UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, check_id)
    REFERENCES bms_restaurant_checks(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku),
  CHECK (cardinality(modifier_names) = cardinality(modifier_codes)),
  CHECK ((status = 'SENT') = (sent_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_check_items_check
  ON bms_restaurant_check_items (tenant_id, check_id, created_at);

CREATE TABLE IF NOT EXISTS bms_restaurant_kitchen_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  check_id       UUID NOT NULL,
  check_item_id  UUID NOT NULL,
  station        TEXT,
  status         TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'
  )),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, check_item_id),
  FOREIGN KEY (tenant_id, check_id)
    REFERENCES bms_restaurant_checks(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, check_item_id)
    REFERENCES bms_restaurant_check_items(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kitchen_queue
  ON bms_restaurant_kitchen_tickets (tenant_id, station, status, created_at);

-- One BMS order settles one restaurant check.  The reverse pointer makes
-- check reads cheap, while both composite FKs retain tenant ownership.
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS restaurant_check_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_restaurant_check
  ON bms_orders (tenant_id, restaurant_check_id)
  WHERE restaurant_check_id IS NOT NULL AND status <> 'CANCELLED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_orders_restaurant_check_fk') THEN
    ALTER TABLE bms_orders ADD CONSTRAINT bms_orders_restaurant_check_fk
      FOREIGN KEY (tenant_id, restaurant_check_id)
      REFERENCES bms_restaurant_checks(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_restaurant_checks_current_order_fk') THEN
    ALTER TABLE bms_restaurant_checks ADD CONSTRAINT bms_restaurant_checks_current_order_fk
      FOREIGN KEY (tenant_id, current_order_id)
      REFERENCES bms_orders(tenant_id, id);
  END IF;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_restaurant_areas', 'bms_restaurant_tables', 'bms_restaurant_checks',
    'bms_restaurant_check_items', 'bms_restaurant_kitchen_tickets'
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
  bms_restaurant_areas, bms_restaurant_tables, bms_restaurant_checks,
  bms_restaurant_check_items, bms_restaurant_kitchen_tickets
  TO bms_app;

SELECT public.create_revision_trigger('bms_restaurant_areas');
SELECT public.create_revision_trigger('bms_restaurant_tables');
SELECT public.create_revision_trigger('bms_restaurant_checks');
SELECT public.create_revision_trigger('bms_restaurant_check_items');

COMMENT ON TABLE bms_restaurant_checks IS
  'Open dine-in service check. Final payment is delegated to the normal POS order settlement.';
COMMENT ON COLUMN bms_orders.restaurant_check_id IS
  'Restaurant check settled by this POS order; prevents duplicate kitchen-ticket emission at checkout.';
