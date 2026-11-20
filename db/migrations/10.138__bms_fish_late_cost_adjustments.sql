-- Append-only, value-only corrections to confirmed LIVE fish receipts.
-- No stock, lot, movement, payment, payable or accounting expense is created.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_fish_late_cost_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  intake_id UUID NOT NULL,
  intake_line_id BIGINT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('TRANSPORT','ICE','HANDLING','OTHER')),
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  reference TEXT,
  valuation_before NUMERIC(26,6) NOT NULL,
  valuation_after NUMERIC(26,6) NOT NULL,
  stock_qty_at_commit BIGINT NOT NULL CHECK (stock_qty_at_commit >= 0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES bms_fish_intakes(tenant_id,id),
  FOREIGN KEY (tenant_id,intake_line_id) REFERENCES bms_fish_intake_lines(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_fish_late_cost_line_idx
  ON bms_fish_late_cost_adjustments(tenant_id,intake_line_id,created_at,id);
CREATE INDEX IF NOT EXISTS bms_stock_movements_fish_late_cost_idx
  ON bms_stock_movements(tenant_id,location_id,product_sku,size,id)
  WHERE type NOT IN ('RESERVE','RELEASE');
ALTER TABLE bms_fish_late_cost_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_fish_late_cost_adjustments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fish_late_cost_tenant_isolation ON bms_fish_late_cost_adjustments;
CREATE POLICY fish_late_cost_tenant_isolation ON bms_fish_late_cost_adjustments
  USING (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON bms_fish_late_cost_adjustments TO bms_app;
REVOKE UPDATE,DELETE ON bms_fish_late_cost_adjustments FROM bms_app;
COMMENT ON TABLE bms_fish_late_cost_adjustments IS 'Append-only late fish receipt cost; updates current on-hand moving-average value only when no later physical valuation movement exists.';
COMMIT;
-- ROLLBACK: stop the late-cost route first. Retain adjustment and valuation evidence;
-- never delete committed rows or subtract value without a separately reviewed reversal.
