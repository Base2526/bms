-- =============================================================
-- 7.47 — ค่าส่งจริง: เก็บลงออร์เดอร์ + คิดตามโซน/น้ำหนัก
-- -------------------------------------------------------------
-- ปัญหาที่แก้: ก่อนหน้านี้ `estimateShipping()` เป็นค่าเหมาที่ไม่ดูปลายทางเลย
-- และ **ค่าส่งไม่เคยถูกบวกเข้าออร์เดอร์** (bms_orders ไม่มีคอลัมน์ค่าส่ง,
-- generateInvoice เขียน shippingFee: null ไว้ตรง ๆ) → ลูกค้าโอนตามยอดสินค้า
-- ร้านขาดค่าส่งทุกออร์เดอร์
--
-- ⚠️ ความหมายของ total_amount **ไม่เปลี่ยน** = ค่าสินค้า − ส่วนลด
--    (dashboard/report/digest/coupon อ่านคอลัมน์นี้อยู่ ถ้าเปลี่ยนความหมาย
--     ตัวเลขรายได้ย้อนหลังจะเพี้ยนทั้งระบบ)
--    ยอดที่ลูกค้าต้องจ่าย = total_amount + shipping_fee ("amount due")
--    คิดที่จุดเก็บเงิน (payments/checkout/invoice) ไม่ใช่เขียนทับ total_amount
--
-- โซนแบบ 3 ระดับ (BANGKOK / PERIMETER / UPCOUNTRY) — ไม่ได้ทำตาราง 77 จังหวัด
-- เพราะ zone mapping จริงต้องรู้แค่ กรุงเทพ + ปริมณฑล 5 จังหวัด ที่เหลือ = ต่างจังหวัด
-- (ดู lib/bms/shippingRates.ts) validate ที่ service layer ไม่ใช่ CHECK constraint
-- ตาม convention เดิมของ business_type/ai_language
-- =============================================================

-- ค่าส่งต่อออร์เดอร์ (NOT NULL DEFAULT 0 → ออร์เดอร์เก่าทั้งหมด = ไม่มีค่าส่ง ไม่กระทบยอดเดิม)
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- บันทึกว่าค่าส่งนั้นคิดมาจากอะไร (flat / zone / carrier / none) — ไว้ debug ย้อนหลัง
-- และไว้บอกลูกค้าได้ว่าทำไมคิดเท่านี้ ไม่ใช่ตัวเลขลอย ๆ
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS shipping_fee_source TEXT;

-- น้ำหนักสินค้า (กรัม) — nullable โดยเจตนา: สินค้าที่ยังไม่กรอกน้ำหนัก
-- ต้องทำให้ระบบ "ไม่คิดค่าน้ำหนักเพิ่ม + เตือน" ไม่ใช่เดาน้ำหนักเอง
ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER;

-- ที่อยู่แบบมีโครงสร้างเพิ่มเติม — คอลัมน์ address (free text) เดิมยังเป็นตัวหลัก
-- ไม่ย้ายข้อมูล/ไม่บังคับกรอก เพื่อไม่ให้ที่อยู่เดิมทั้งหมดใช้ไม่ได้
ALTER TABLE bms_customer_addresses
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT;

-- config ค่าส่งของร้าน
--   shipping_mode        : 'flat' (เดิม) | 'zone' (ตามจังหวัดปลายทาง) | 'carrier' (ถาม carrier API — ยังเป็น mock)
--   shipping_origin_*    : ต้นทางของร้าน (ไว้แสดง/ไว้ให้ carrier API ใช้ในอนาคต)
--   shipping_zone_rates  : [{"zone":"BANGKOK","fee":40}, ...]
--   shipping_weight_tiers: [{"maxGrams":1000,"surcharge":0}, ...] (เรียงจากน้อยไปมาก)
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS shipping_mode TEXT NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS shipping_origin_province TEXT,
  ADD COLUMN IF NOT EXISTS shipping_origin_postcode TEXT,
  ADD COLUMN IF NOT EXISTS shipping_zone_rates JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_weight_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;
