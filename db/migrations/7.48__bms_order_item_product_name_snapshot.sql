-- =============================================================
-- 7.48  Snapshot product name on order items
-- -------------------------------------------------------------
-- ปัญหา: order invoice / notification ไป join ชื่อสินค้าจาก bms_products สด ๆ
-- ถ้าร้าน rename สินค้าทีหลัง เอกสารย้อนหลังจะเปลี่ยนตาม ทำให้ audit ไม่คงที่
-- =============================================================

ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS product_name TEXT;

-- เติมข้อมูลย้อนหลังเท่าที่ทำได้จากชื่อสินค้าปัจจุบัน เพื่อไม่ให้ invoice เก่าดูว่าง
UPDATE bms_order_items oi
   SET product_name = COALESCE(oi.product_name, p.name)
  FROM bms_products p
 WHERE p.tenant_id = oi.tenant_id
   AND p.sku = oi.product_sku
   AND oi.product_name IS NULL;

