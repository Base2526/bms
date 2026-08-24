-- =============================================================
-- 9.21  Pack-aware order-item line uniqueness
-- -------------------------------------------------------------
-- 7.86 ทำให้บิลหนึ่งใบขาย SKU+ไซซ์เดียวกันได้ทั้งหน่วยฐานและแพ็ก แต่
-- constraint ตั้งแต่ 3.3 ยังบังคับ unique แค่ (order, SKU, size) จึง insert
-- บรรทัด "1 กล่อง + 3 ชิ้น" ไม่ได้ แม้ service จะแยกสองหน่วยขายถูกต้องแล้ว
--
-- BASE / null / ค่าว่างคือหน่วยฐานเดียวกัน และ pack code ไม่ควรต่างกันเพราะ
-- case หรือช่องว่าง จึง normalize ใน expression index ให้ตรงกับ service
-- รันซ้ำได้ปลอดภัย
-- =============================================================

ALTER TABLE bms_order_items
  DROP CONSTRAINT IF EXISTS bms_order_items_order_id_product_sku_size_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_order_items_order_sku_size_pack
  ON bms_order_items (
    order_id,
    product_sku,
    size,
    (COALESCE(NULLIF(upper(btrim(pack_code)), ''), 'BASE'))
  );

COMMENT ON INDEX uq_bms_order_items_order_sku_size_pack IS
  'One order line per SKU, size, and normalized selling unit; null/blank/BASE are the same base unit';
