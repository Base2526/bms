-- =============================================================
-- 9.34 — POS returns received at another branch
-- -------------------------------------------------------------
-- A sale branch and a return branch are two separate facts.  The original
-- order keeps the branch that supplied the goods; the return records the
-- branch that physically received them and whose shift paid any cash refund.
-- =============================================================

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS sale_location_id UUID REFERENCES bms_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS return_location_id UUID REFERENCES bms_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cross_branch BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE bms_pos_returns pr
   SET source_channel = COALESCE(pr.source_channel, o.channel),
       sale_location_id = COALESCE(pr.sale_location_id, o.location_id)
  FROM bms_orders o
 WHERE o.tenant_id = pr.tenant_id
   AND o.id = pr.order_id
   AND (
     pr.source_channel IS NULL
     OR pr.sale_location_id IS NULL
   );

UPDATE bms_pos_returns pr
   SET return_location_id = d.location_id
  FROM bms_pos_devices d
 WHERE d.tenant_id = pr.tenant_id
   AND d.id = pr.pos_device_id
   AND pr.return_location_id IS NULL;

UPDATE bms_pos_returns
   SET cross_branch = sale_location_id <> return_location_id
 WHERE sale_location_id IS NOT NULL
   AND return_location_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_returns_cross_branch_locations_check'
  ) THEN
    ALTER TABLE bms_pos_returns
      ADD CONSTRAINT bms_pos_returns_cross_branch_locations_check
      CHECK (
        sale_location_id IS NULL
        OR return_location_id IS NULL
        OR cross_branch = (sale_location_id <> return_location_id)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_pos_returns_sale_location
  ON bms_pos_returns (tenant_id, sale_location_id, created_at DESC)
  WHERE sale_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_pos_returns_return_location
  ON bms_pos_returns (tenant_id, return_location_id, created_at DESC)
  WHERE return_location_id IS NOT NULL;

-- lot_id remains the immutable source-lot provenance.  restock_lot_id is the
-- lot row that received the quantity; it differs when the return crosses a
-- branch.  Keeping both prevents recall history from being rewritten.
ALTER TABLE bms_pos_return_item_lots
  ADD COLUMN IF NOT EXISTS restock_lot_id UUID REFERENCES bms_inventory_lots(id) ON DELETE RESTRICT;

UPDATE bms_pos_return_item_lots
   SET restock_lot_id = lot_id
 WHERE restock_lot_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_bms_pos_return_item_lots_restock
  ON bms_pos_return_item_lots (tenant_id, restock_lot_id)
  WHERE restock_lot_id IS NOT NULL;

COMMENT ON COLUMN bms_pos_returns.source_channel IS
  'ช่องทางของบิลต้นทาง ณ เวลารับคืน; ไม่ใช่ช่องทางของเครื่อง POS ที่รับคืน (9.34)';
COMMENT ON COLUMN bms_pos_returns.sale_location_id IS
  'สาขาที่ขาย/ตัด stock ของบิลต้นทาง (9.34)';
COMMENT ON COLUMN bms_pos_returns.return_location_id IS
  'สาขาที่รับสินค้ากลับเข้าร้านจริง (9.34)';
COMMENT ON COLUMN bms_pos_returns.cross_branch IS
  'TRUE เมื่อสาขารับคืนต่างจากสาขาขาย; ต้องมีสิทธิ์และผู้อนุมัติข้ามสาขา (9.34)';
COMMENT ON COLUMN bms_pos_return_item_lots.lot_id IS
  'lot ต้นทางที่เคยถูกจ่ายให้ลูกค้า; provenance ห้ามเปลี่ยนเมื่อคืนข้ามสาขา';
COMMENT ON COLUMN bms_pos_return_item_lots.restock_lot_id IS
  'lot ปลายทางที่รับจำนวนคืน; เท่ากับ lot_id เมื่อคืนสาขาเดิม (9.34)';

-- Cross-branch receiving can move both stock and cash between operational
-- reports.  Seed the permission to Manager only; Administrator is super.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.return.cross_branch'
  FROM bms_tenants t
  JOIN roles r ON r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
