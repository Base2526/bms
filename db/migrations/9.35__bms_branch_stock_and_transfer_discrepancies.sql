-- =============================================================
-- 9.35 — Branch-visible inventory and transfer discrepancies
-- =============================================================

-- ของเสียหายที่มาถึงปลายทางยังเป็นทรัพย์สินที่ต้องตามได้ แต่ห้ามปนกับ
-- current_stock ซึ่ง POS ใช้ขาย จึงเก็บเป็น bucket แยกต่อสาขา/SKU/ไซซ์
ALTER TABLE bms_inventory
  ADD COLUMN IF NOT EXISTS quarantine_stock INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_inventory_quarantine_stock_check'
  ) THEN
    ALTER TABLE bms_inventory
      ADD CONSTRAINT bms_inventory_quarantine_stock_check CHECK (quarantine_stock >= 0);
  END IF;
END $$;

ALTER TABLE bms_stock_transfers
  ADD COLUMN IF NOT EXISTS receiving_note TEXT;

ALTER TABLE bms_stock_transfer_items
  ADD COLUMN IF NOT EXISTS damaged_qty INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discrepancy_reason TEXT,
  ADD COLUMN IF NOT EXISTS discrepancy_note TEXT;

-- แถวเก่าที่เคยรับขาดมีตัวเลขอยู่แล้ว แต่ไม่มีเหตุผลจากผู้รับ จึงติดป้าย legacy
-- แทนการแต่งเหตุผลย้อนหลัง
UPDATE bms_stock_transfer_items
   SET discrepancy_reason = 'LEGACY_SHORT_RECEIPT'
 WHERE received_qty IS NOT NULL
   AND received_qty < qty
   AND discrepancy_reason IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_stock_transfer_items_damaged_qty_check'
  ) THEN
    ALTER TABLE bms_stock_transfer_items
      ADD CONSTRAINT bms_stock_transfer_items_damaged_qty_check
      CHECK (damaged_qty >= 0 AND (received_qty IS NULL OR received_qty + damaged_qty <= qty));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_stock_transfer_items_discrepancy_reason_check'
  ) THEN
    ALTER TABLE bms_stock_transfer_items
      ADD CONSTRAINT bms_stock_transfer_items_discrepancy_reason_check
      CHECK (discrepancy_reason IS NULL OR discrepancy_reason IN (
        'LOST_IN_TRANSIT', 'SOURCE_SHORT_SHIP', 'COUNT_ERROR', 'DAMAGED', 'OTHER',
        'LEGACY_SHORT_RECEIPT'
      ));
  END IF;
END $$;

ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;
ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_type_check
  CHECK (type IN ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','SHIP','RETURN',
                  'TRANSFER_IN','TRANSFER_OUT','COUNT_ADJUST','QUARANTINE_IN'));

COMMENT ON COLUMN bms_inventory.quarantine_stock IS
  'ของที่สาขาถืออยู่แต่ห้ามขาย เช่น ของเสียหายจากการโอน (9.35)';
COMMENT ON COLUMN bms_stock_transfer_items.received_qty IS
  'จำนวนสภาพดีที่เพิ่มเข้า current_stock ปลายทาง';
COMMENT ON COLUMN bms_stock_transfer_items.damaged_qty IS
  'จำนวนที่มาถึงแต่กักกัน/ขายไม่ได้ เพิ่มเข้า quarantine_stock ปลายทาง';
COMMENT ON COLUMN bms_stock_transfer_items.discrepancy_reason IS
  'เหตุผลหลักเมื่อ received_qty + damaged_qty ไม่เท่าจำนวนส่ง หรือมีของเสียหาย';
COMMENT ON COLUMN bms_stock_transfer_items.discrepancy_note IS
  'คำอธิบายจากผู้รับเมื่อมีส่วนต่าง บังคับโดย service สำหรับรายการใหม่';
