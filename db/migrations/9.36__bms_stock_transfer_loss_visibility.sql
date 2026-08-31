-- =============================================================
-- 9.36 — Stock transfer loss visibility
-- =============================================================

-- ของที่ส่งออกแล้วแต่ปลายทางตรวจไม่พบไม่ใช่ stock พร้อมขาย และไม่ใช่ของกักกัน
-- จึงแยก movement type ออกจาก STOCK_OUT เพื่อให้รายงาน/หน้าสินค้าแยก loss
-- จากการปรับสต็อกทั่วไปได้ชัดเจน
ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;
ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_type_check
  CHECK (type IN ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','SHIP','RETURN',
                  'TRANSFER_IN','TRANSFER_OUT','COUNT_ADJUST','QUARANTINE_IN',
                  'TRANSFER_LOST'));

COMMENT ON CONSTRAINT bms_stock_movements_type_check ON bms_stock_movements IS
  '9.36 adds TRANSFER_LOST for units sent in a transfer but not found at receiving.';
