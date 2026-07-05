-- =============================================================
-- 3.5  BMS OMS — ขยาย state machine เต็ม
-- -------------------------------------------------------------
-- PENDING → PAID → PACKING → SHIPPED → COMPLETED
--   ├─ (PENDING/PAID/PACKING) → CANCELLED  (คืน reserved)
--   └─ (SHIPPED/COMPLETED)    → RETURNED   (คืนสต็อกเข้าคลัง)
--
-- map ของเดิม: RESERVED→PENDING, CONFIRMED→PAID, FULFILLED→COMPLETED
-- movement: FULFILL → SHIP, เพิ่ม RETURN
-- =============================================================

-- ---- orders.status ----
ALTER TABLE bms_orders ALTER COLUMN status DROP DEFAULT;
ALTER TABLE bms_orders DROP CONSTRAINT IF EXISTS bms_orders_status_check;

UPDATE bms_orders SET status = CASE status
  WHEN 'RESERVED'  THEN 'PENDING'
  WHEN 'CONFIRMED' THEN 'PAID'
  WHEN 'FULFILLED' THEN 'COMPLETED'
  ELSE status
END;

ALTER TABLE bms_orders ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE bms_orders ADD CONSTRAINT bms_orders_status_check
  CHECK (status IN ('PENDING','PAID','PACKING','SHIPPED','COMPLETED','CANCELLED','RETURNED'));

-- ---- stock movement types ----
ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;
UPDATE bms_stock_movements SET type = 'SHIP' WHERE type = 'FULFILL';
ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_type_check
  CHECK (type IN ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','SHIP','RETURN'));
