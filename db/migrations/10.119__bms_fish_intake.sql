-- 10.119 Fish-dock evidence and stock receipts.
-- Historical imports are evidence only. LIVE and OPENING are explicit, confirmed
-- stock writes; their line amount is the authoritative reviewed THB amount.
CREATE TABLE IF NOT EXISTS bms_fish_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('HISTORICAL', 'LIVE', 'OPENING')),
  location_id UUID REFERENCES bms_locations(id),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  source_name TEXT,
  source_sheet TEXT,
  source_year INTEGER,
  note TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, request_key),
  CHECK ((kind = 'HISTORICAL' AND location_id IS NULL)
      OR (kind <> 'HISTORICAL' AND location_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS bms_fish_intake_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  intake_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 3),
  bill_date DATE,
  received_date DATE,
  supplier_name TEXT,
  vessel_registration TEXT,
  fish_name TEXT NOT NULL,
  bill_size TEXT,
  actual_size TEXT,
  sku TEXT,
  size TEXT,
  bill_grams BIGINT CHECK (bill_grams IS NULL OR bill_grams >= 0),
  received_grams BIGINT NOT NULL CHECK (received_grams BETWEEN 1 AND 2147483647),
  unit_price_per_kg NUMERIC(14,4) CHECK (unit_price_per_kg IS NULL OR unit_price_per_kg >= 0),
  purchase_amount NUMERIC(16,2) NOT NULL CHECK (purchase_amount >= 0),
  extra_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (extra_amount >= 0),
  quality TEXT,
  note TEXT,
  lot_no TEXT,
  expiry_date DATE,
  movement_id BIGINT,
  UNIQUE (tenant_id, id),
  UNIQUE (intake_id, line_no),
  UNIQUE (tenant_id, movement_id),
  FOREIGN KEY (tenant_id, intake_id) REFERENCES bms_fish_intakes(tenant_id, id),
  FOREIGN KEY (tenant_id, sku) REFERENCES bms_products(tenant_id, sku),
  FOREIGN KEY (movement_id) REFERENCES bms_stock_movements(id)
);

CREATE INDEX IF NOT EXISTS bms_fish_intakes_recent_idx
  ON bms_fish_intakes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bms_fish_lines_lookup_idx
  ON bms_fish_intake_lines (tenant_id, bill_date, supplier_name);

ALTER TABLE bms_inventory_value_entries
  ADD COLUMN IF NOT EXISTS fish_intake_line_id BIGINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_inventory_value_fish_line_fk') THEN
    ALTER TABLE bms_inventory_value_entries
      ADD CONSTRAINT bms_inventory_value_fish_line_fk
      FOREIGN KEY (tenant_id, fish_intake_line_id)
      REFERENCES bms_fish_intake_lines (tenant_id, id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bms_inventory_value_fish_line_idx
  ON bms_inventory_value_entries (tenant_id, fish_intake_line_id)
  WHERE fish_intake_line_id IS NOT NULL;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_fish_intakes', 'bms_fish_intake_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS fish_tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY fish_tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid)',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app', t);
  END LOOP;
END $$;
GRANT UPDATE (movement_id, lot_no) ON bms_fish_intake_lines TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_fish_intake_lines_id_seq TO bms_app;

COMMENT ON TABLE bms_fish_intakes IS 'Confirmed fish-dock imports and receipts; historical rows never move stock.';
COMMENT ON COLUMN bms_fish_intake_lines.purchase_amount IS 'Reviewed invoice amount in THB; never recomputed from received weight.';
COMMENT ON COLUMN bms_fish_intake_lines.received_grams IS 'Actual received quantity in integer grams for stock and lot accounting.';
-- ROLLBACK: stop fish-intake routes first; retain evidence and movements. Do not
-- delete confirmed rows or reverse stock with a schema rollback.
