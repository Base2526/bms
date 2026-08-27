-- =============================================================
-- 9.29 — เภสัชกรอนุมัติการจ่ายยาที่เครื่องขาย (แบบร้านยาทั่วไป)
-- -------------------------------------------------------------
-- ก่อนหน้านี้ยาที่ไม่ใช่ DIRECT_SALE มีทางเดียวคือ "เปิดเคสในคิวเภสัชกร" ซึ่งเป็น
-- flow แบบออนไลน์ (ซักประวัติเป็นข้อความ ลูกค้ายืนยัน เภสัชกรอนุมัติทีหลัง) ·
-- ร้านยาจริงไม่ได้ทำงานแบบนั้น: เภสัชกรยืนอยู่ที่เคาน์เตอร์ ดูของ ถามคนซื้อสองสามคำ
-- แล้วบอกว่าจ่ายได้ — หลักฐานที่ควรเก็บคือ "ใครอนุมัติ ยาอะไร เมื่อไร" ไม่ใช่บทสนทนา
--
-- ผลของการไม่มีทางนี้คือทางตัน 2 จุดที่ขายไม่ได้เลย:
--   • `PRESCRIPTION_REQUIRED` — ไม่มีเส้นทางไหนในระบบจ่ายยากลุ่มนี้ได้ (คิวก็เปิดไม่ได้
--     เพราะ requestPosPharmacyReview ปฏิเสธ และหน้าคิวเลือกเข้า draft ไม่ได้)
--   • `PHARMACY_POLICY_UNKNOWN` — SKU ที่ยังไม่มีใครรีวิว ขายไม่ได้กลางคิวลูกค้า
--
-- ตารางนี้คือหลักฐานของการอนุมัติที่เคาน์เตอร์ · เขียนใน **ทรานแซกชันเดียวกับบิล**
-- ที่มันอนุมัติ (เหมือน bms_pos_deposits/แต้ม) — บิลที่ commit แล้วจะไม่มีทางไม่มี
-- หลักฐานว่าใครปล่อยของออกไป
--
-- ⚠️ สิ่งที่ตารางนี้ **ไม่** ทำ: ไม่คลายเพดานจำนวนต่อครั้ง (`max_quantity`) เพราะนั่น
-- เป็นค่าที่ร้านตั้งไว้เอง การจะขายเกินคือการแก้ policy ไม่ใช่การกด PIN หน้าร้าน
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_pharmacist_authorizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  -- ไม่มี FK composite ไป bms_products โดยตั้งใจ: นี่คือหลักฐานทางคลินิก ต้องอ่านได้
  -- ต่อไปแม้สินค้าจะถูกลบออกจากแคตาล็อกภายหลัง
  product_sku         TEXT NOT NULL,
  size                TEXT NOT NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  -- นโยบายที่ถูกปลด ณ เวลานั้น (ไม่ใช่ค่าปัจจุบันของสินค้า) — ร้านแก้ policy ทีหลัง
  -- ต้องไม่เปลี่ยนความหมายของหลักฐานที่ออกไปแล้ว
  sale_policy         TEXT NOT NULL,
  policy_status       TEXT NOT NULL,
  pharmacist_user_id  UUID NOT NULL REFERENCES users(id),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- บิลเดียว/SKU เดียว/ไซซ์เดียว มีการอนุมัติแถวเดียว (ยิงซ้ำด้วย idempotency key
  -- เดิมจะ replay บิลเดิม ไม่ได้สร้างหลักฐานซ้ำ)
  UNIQUE (tenant_id, order_id, product_sku, size)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_rx_auth_recent
  ON bms_pos_pharmacist_authorizations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_pos_rx_auth_pharmacist
  ON bms_pos_pharmacist_authorizations (tenant_id, pharmacist_user_id, created_at DESC);

COMMENT ON TABLE bms_pos_pharmacist_authorizations IS
  'หลักฐานว่าเภสัชกรคนไหนอนุมัติจ่ายยารายการไหนที่เคาน์เตอร์ เขียนในทรานแซกชันเดียวกับบิล (9.29)';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_pos_pharmacist_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_pharmacist_authorizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_rx_auth_tenant_isolation ON bms_pos_pharmacist_authorizations;
CREATE POLICY bms_pos_rx_auth_tenant_isolation ON bms_pos_pharmacist_authorizations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT ON bms_pos_pharmacist_authorizations TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- ตั้งค่าระดับร้าน -------------------------------------------------
-- 1) เปิด/ปิดการอนุมัติที่เครื่อง · ค่าปริยาย TRUE = ร้านยาทั่วไปขายได้ทันที
--    ร้านที่ต้องการบังคับให้ทุกอย่างผ่านคิว (มีเภสัชกรอยู่หลังบ้านคนเดียว) ปิดได้
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS pharmacy_counter_authorization BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN bms_store_profile.pharmacy_counter_authorization IS
  'ให้เภสัชกรที่มีใบอนุญาตกด PIN อนุมัติจ่ายยาที่เครื่องขายได้ (9.29)';

-- 2) เดิม assertPharmacyPolicyReadyToOpenShift() บล็อกการเปิดกะเสมอเมื่อยังมี SKU
--    ที่เภสัชกรไม่ได้อนุมัติ policy · ตอนนี้ SKU แบบนั้นไม่ใช่ทางตันแล้ว (ขอ PIN
--    เภสัชกรแทน) การบล็อกทั้งร้านจึงเป็นแค่ความฝืด → เปลี่ยนเป็น opt-in
--    ร้านที่เคยเลือก "รีวิวทุกตัวก่อนเปิดร้าน" ต้องตั้งคอลัมน์นี้เป็น TRUE เอง
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS pharmacy_block_shift_on_unreviewed_policy BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_store_profile.pharmacy_block_shift_on_unreviewed_policy IS
  'TRUE = เปิดกะไม่ได้ถ้ายังมีสินค้าที่ policy ไม่ APPROVED (พฤติกรรมเดิมก่อน 9.29)';
