-- =============================================================
-- 8.3 — เลขเครื่อง / IMEI ต่อชิ้น (serial number)
-- -------------------------------------------------------------
-- 7.85 มีล็อต (bms_inventory_lots) ซึ่งตอบเรื่อง "ของรุ่นนี้เข้ามาชุดไหน หมดอายุเมื่อไร"
-- แต่ล็อต ≠ serial: ล็อตคือกลุ่ม serial คือชิ้น · สินค้ามีประกัน (มือถือ เครื่องใช้ไฟฟ้า
-- นาฬิกา) ต้องรู้ว่า "เครื่องเลขนี้" ขายให้ใครวันไหน ไม่ใช่แค่มาจากล็อตไหน
--
-- ขอบเขต v1 — เก็บตอนขาย ไม่ใช่ตอนรับเข้า:
--   ร้านเล็กไม่ทำ serial receiving (ไม่มีใครนั่งยิง 50 เครื่องเข้าระบบตอนของมาถึง)
--   แต่ตอนขายต้องยิงกล่องอยู่แล้ว จึงเก็บตรงนั้น · แลกกับการที่จำนวน serial ในระบบ
--   จะไม่เท่าจำนวนสต็อกจนกว่าจะขายหมด ซึ่งยอมรับได้และตรงกับที่ร้านทำงานจริง
--
--   บังคับเฉพาะช่องทาง POS · ออร์เดอร์ออนไลน์ยังไม่บังคับ เพราะตอนกดสั่งไม่มีใคร
--   รู้ว่าจะหยิบเครื่องไหนไปส่ง (คนแพ็กเป็นคนรู้) การบังคับตรงนั้นคือทำให้สั่งของ
--   ออนไลน์ไม่ได้เลย · ดู § ที่ยังไม่ครอบคลุม ใน docs/business/pos.md
-- =============================================================

ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS serial_tracked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_products.serial_tracked IS
  'TRUE = ขายหน้าร้านต้องระบุเลขเครื่องครบทุกชิ้น (8.3)';

CREATE TABLE IF NOT EXISTS bms_product_serials (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku   TEXT NOT NULL,
  size          TEXT NOT NULL,
  -- เลขเครื่องตามที่พิมพ์บนตัวสินค้า/กล่อง · เก็บตามที่ยิงมา ไม่ normalize
  -- (IMEI เป็นตัวเลข แต่ serial ของหลายแบรนด์มีตัวอักษรและ - ปนอยู่จริง)
  serial        TEXT NOT NULL CHECK (btrim(serial) <> ''),
  status        TEXT NOT NULL DEFAULT 'SOLD'
                  CHECK (status IN ('IN_STOCK','SOLD','RETURNED')),
  location_id   UUID REFERENCES bms_locations(id),
  order_id      UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  sold_at       TIMESTAMPTZ,
  returned_at   TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- เลขเครื่องซ้ำในร้านเดียวกันไม่ได้ — เครื่องหนึ่งเครื่องมีเลขเดียว
  -- ข้ามร้านซ้ำได้ (เครื่องมือสองที่ย้ายร้าน หรือร้านคนละสาขาคนละ tenant)
  UNIQUE (tenant_id, serial),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_serials_order
  ON bms_product_serials (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_bms_serials_sku_status
  ON bms_product_serials (tenant_id, product_sku, status);

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_product_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_serials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_serials_tenant_isolation ON bms_product_serials;
CREATE POLICY bms_product_serials_tenant_isolation ON bms_product_serials
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_serials TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- ใช้ product.edit / order.view เดิม: การเปิดโหมดติดตามเลขเครื่องคือการตั้งค่าสินค้า
-- และการค้นหาว่าเครื่องเลขนี้ขายให้ใครคือการดูออร์เดอร์ · ไม่มีอะไรให้ seed
