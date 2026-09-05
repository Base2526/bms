/**
 * ประกาศช่องทางขายให้สินค้าทดสอบ (`FAKE-*`) ของ tenant หนึ่ง
 *
 * ตั้งแต่ `9.51` สินค้าที่ไม่มีแถวใน `bms_product_sales_surfaces` เป็น **ฉบับร่าง** — ขายไม่ได้
 * ทุกช่องทาง (`INVALID_PACK` ที่เคาน์เตอร์ · `NOT_FOUND` ทางออนไลน์) · fixture ที่ INSERT
 * `bms_products` ตรง ๆ (ไม่ผ่าน `upsertProduct`) จึงล้มตั้งแต่บิลแรกแล้วลามทั้งชุด เพราะเทส
 * ถัดไปได้ `orderId` เป็นสตริงว่าง — เป็นเหตุผลเดียวของเทส DB ที่แดงค้าง 119 ตัวบน develop
 *
 * **จำกัดที่ `FAKE-%`/`TEST-%` โดยตั้งใจ** — หลายชุดใช้ร้านจริงของฐาน dev ร่วมกัน การเปิดช่องทางขาย
 * ให้สินค้าทุกตัวของร้านนั้นคือการแก้ข้อมูลจริงของผู้ใช้ · teardown ลบสินค้าทดสอบอยู่แล้ว
 * และ FK เป็น CASCADE แถวช่องทางขายจึงหายตามไปเอง ไม่ต้องตามลบ
 */
export const DECLARE_FAKE_SALES_SURFACES_SQL = `
  INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
  SELECT p.tenant_id, p.sku, s.surface
    FROM bms_products p
    CROSS JOIN (VALUES ('RETAIL_POS'),('RESTAURANT_POS'),('ONLINE_ORDER'),('CUSTOMER_AI'))
      AS s(surface)
   WHERE p.tenant_id = $1 AND (p.sku LIKE 'FAKE-%' OR p.sku LIKE 'TEST-%')
  ON CONFLICT DO NOTHING`;
