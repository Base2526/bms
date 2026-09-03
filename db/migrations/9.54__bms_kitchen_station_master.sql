-- 9.54 สถานีครัวเป็น "ของจริง" ไม่ใช่ข้อความอิสระ
--
-- ก่อนหน้านี้สถานีครัวมีอยู่แค่ในฐานะสตริงบน bms_product_stock_policies.kitchen_station
-- ผลคือทุกอย่างที่ต้องอ้างถึงสถานีต้องอ้างด้วย "ชื่อที่พิมพ์ตรงกันเป๊ะ": เกณฑ์เวลา (9.53)
-- คีย์ด้วยชื่อ · ตั๋วครัวเก็บชื่อ · ตัวกรองบนจอครัวสร้างจากชื่อที่บังเอิญมีงานค้างอยู่
-- พิมพ์ "บาร์ " เกินมาหนึ่งช่องว่างคือสถานีใหม่ทั้งสถานี และ **เปลี่ยนชื่อสถานีไม่ได้เลย**
-- เพราะชื่อคือ identity — แก้ชื่อแปลว่าเมนูทุกตัวชี้ไปที่สถานีที่ไม่มีอยู่
--
-- ตารางนี้ทำให้สถานีมี id ของตัวเอง เปิด/ปิดได้ เรียงลำดับได้ และผูกสาขาได้
--
-- ⚠️ สามข้อที่ห้ามเข้าใจผิด (เขียนไว้ที่นี่เพราะ migration คือที่ที่คนอ่านก่อนแก้ schema):
--   1. **สถานีไม่ใช่สาขา** — สต็อกยังตัดตาม location_id ของบิล/เครื่องขายเหมือนเดิมทุกประการ
--      สถานีบอกแค่ "ใครทำอาหารจานนี้" ไม่เคยแตะเส้นทางสต็อกหรือเงิน
--   2. **location_id NULL = สถานีระดับร้าน ใช้ได้ทุกสาขา** · มีค่า = สถานีของสาขานั้นสาขาเดียว
--      สินค้าหนึ่งตัวขายได้หลายสาขา การผูกเมนูกับสถานีเฉพาะสาขาจึงเป็นการตัดสินใจของร้าน
--      ไม่ใช่ค่าปริยาย (ชั้นแอปเลือกสถานีระดับร้านเป็นค่าตั้งต้นเสมอ)
--   3. **ตั๋วครัวเก็บทั้ง station_id และชื่อ (snapshot)** — เปลี่ยนชื่อสถานีวันนี้ต้องไม่
--      เปลี่ยนประวัติว่าเมื่อวานอาหารออกจากครัวชื่ออะไร
--
-- ไม่มี permission ใหม่: อ่านใช้ product.view · จัดการใช้ product.edit (สิทธิ์เดียวกับ
-- รูปแบบสต็อก/เกณฑ์เวลา ซึ่งดูแลหน้า /admin/stock-models อยู่แล้ว)

BEGIN;

-- ---- 1. ตารางหลักของสถานี ------------------------------------------
CREATE TABLE IF NOT EXISTS bms_kitchen_stations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- NULL = ใช้ได้ทุกสาขา · มีค่า = ของสาขานั้นเท่านั้น (ดูข้อ 2 ด้านบน)
  location_id        UUID,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  -- เผื่ออนาคต: ยังไม่มีระบบ printer profile ในระบบนี้เลย จึงไม่มี FK และ **ไม่มีผู้อ่าน**
  -- ห้ามเดาการต่อเครื่องพิมพ์จากคอลัมน์นี้ — ต้องมีตาราง printer profile จริงก่อน
  printer_profile_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- ตรวจรูปแบบหลวม ๆ ที่ชั้นฐาน (ห้ามช่องว่าง/ต้องเป็นตัวพิมพ์ใหญ่หลัง normalize) แล้วให้
  -- ชั้นแอปเป็นคนบอกเหตุผลที่คนอ่านรู้เรื่อง — ข้อความของ Postgres ใช้ไม่ได้กับคนตั้งค่าหน้าร้าน
  -- upper() บนอักษรไทยไม่เปลี่ยนอะไร ร้านไทยจึงตั้งรหัสเป็นภาษาไทยได้ตามปกติ
  CONSTRAINT bms_kitchen_stations_code_check
    CHECK (btrim(code) = code AND code <> '' AND length(code) <= 32
           AND code = upper(code) AND code !~ '[[:space:]]'),
  CONSTRAINT bms_kitchen_stations_name_check
    CHECK (btrim(name) <> '' AND length(name) <= 64),
  CONSTRAINT bms_kitchen_stations_sort_check
    CHECK (sort_order BETWEEN -9999 AND 9999),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);

-- UNIQUE ธรรมดาไม่คุม location_id NULL (NULL ไม่ชนกับ NULL) → ต้องแยกสองดัชนี
-- ไม่งั้นสถานีระดับร้านชื่อซ้ำกันได้ไม่จำกัดจำนวน
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_kitchen_stations_code_global
  ON bms_kitchen_stations (tenant_id, code) WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_kitchen_stations_code_branch
  ON bms_kitchen_stations (tenant_id, location_id, code) WHERE location_id IS NOT NULL;

-- ⚠️ ชื่อสถานีต้องไม่ซ้ำ "ทั้งร้าน" ข้ามทุกสาขาและทุกสถานะ ไม่ใช่แค่ในสาขาเดียวกัน
--
-- เหตุผลไม่ใช่ความสวยงาม: เกณฑ์เวลา (bms_kitchen_station_slas ของ 9.53) คีย์ด้วย "ชื่อ"
-- และตั๋วเก่าทุกใบถือแต่ชื่อ ถ้าปล่อยให้สองสถานีชื่อ "บาร์" อยู่ร่วมกัน การหาเกณฑ์เวลา
-- ของตั๋วจะมีคำตอบสองคำตอบโดยไม่มีทางเลือกว่าอันไหนถูก
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_kitchen_stations_name
  ON bms_kitchen_stations (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_bms_kitchen_stations_listing
  ON bms_kitchen_stations (tenant_id, active, sort_order, name);

COMMENT ON TABLE bms_kitchen_stations IS
  'Kitchen station master (9.54). A station is a work area inside one branch, never a branch and never a stock location — stock still moves by the order location_id. location_id NULL means the station serves every branch.';
COMMENT ON COLUMN bms_kitchen_stations.printer_profile_id IS
  'Reserved for per-station printer routing. No printer profile table exists yet, nothing reads this column, and no UI writes it.';

-- ---- 2. ยกสถานีเดิมทุกชื่อขึ้นเป็นแถวหลัก ---------------------------
--
-- ต้องกวาดให้ครบทุกแหล่ง ไม่ใช่แค่ stock policy: เกณฑ์เวลาที่ตั้งไว้แล้ว และตั๋วที่ยังค้าง
-- อยู่บนกระดานตอน migrate ก็ถือชื่อสถานีอยู่ ถ้าตกไปแถวใดแถวหนึ่ง สถานีนั้นจะกลายเป็น
-- "ชื่อที่ไม่มีเจ้าของ" แล้วหน้าตั้งค่าไม่มีทางแก้เกณฑ์เวลาของมันได้อีก
--
-- ทุกแถวเกิดเป็น location_id NULL (ระดับร้าน) เพราะข้อมูลเดิมไม่เคยผูกสาขา — การเดาสาขา
-- ให้เองคือการตัดสินใจแทนร้าน และผิดทันทีสำหรับร้านที่มีสาขาเดียวชื่อเดียวกันหลายครัว
WITH used AS (
  SELECT tenant_id, btrim(kitchen_station) AS name
    FROM bms_product_stock_policies
   WHERE btrim(COALESCE(kitchen_station, '')) <> ''
  UNION
  SELECT tenant_id, btrim(station) FROM bms_kitchen_station_slas
   WHERE btrim(COALESCE(station, '')) <> ''
  UNION
  SELECT tenant_id, btrim(station) FROM bms_kitchen_tickets
   WHERE btrim(COALESCE(station, '')) <> ''
  UNION
  SELECT tenant_id, btrim(station) FROM bms_restaurant_kitchen_tickets
   WHERE btrim(COALESCE(station, '')) <> ''
), named AS (
  SELECT DISTINCT tenant_id, LEFT(name, 64) AS name FROM used
), slugged AS (
  -- รหัสต้อง derive แบบเดิมทุกครั้ง (deterministic): ตัวพิมพ์ใหญ่ · อะไรที่ไม่ใช่ตัวอักษร/
  -- ตัวเลข/_/- กลายเป็น _ · ตัด _ หัวท้าย · ตัดที่ 32 **แล้วค่อยตัด _ ท้ายอีกครั้ง**
  -- (ลำดับเดียวกับ normalizeKitchenStationCode() ในชั้นแอป)
  --
  -- ⚠️ ช่วง ก-๙ (U+0E01-U+0E59) ถูกระบุตรง ๆ เพราะ [[:alnum:]] จะจำแนกสระ/วรรณยุกต์ไทย
  -- (ั ้ ่ ฯลฯ) เป็น alnum หรือไม่ ขึ้นกับ locale ของเซิร์ฟเวอร์ — ถ้าไม่ "ครัวร้อน" กลายเป็น
  -- "คร_วร_อน" บนเครื่องหนึ่งและถูกต้องบนอีกเครื่องหนึ่ง · รหัสไม่จำเป็นต้องตรงกับที่ชั้นแอป
  -- derive แบบไบต์ต่อไบต์ (การจับคู่สถานีใช้ "ชื่อ" ไม่ใช่รหัส) แต่ต้องผ่าน CHECK เดียวกันเสมอ
  SELECT tenant_id, name,
         NULLIF(btrim(LEFT(btrim(regexp_replace(upper(name), '[^[:alnum:]ก-๙_-]+', '_', 'g'), '_-'), 32), '_-'), '')
           AS slug
    FROM named
), coded AS (
  SELECT tenant_id, name,
         COALESCE(slug, 'STATION') AS base_code,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, COALESCE(slug, 'STATION') ORDER BY name)
           AS dup
    FROM slugged
)
INSERT INTO bms_kitchen_stations (tenant_id, location_id, code, name, sort_order)
SELECT tenant_id, NULL,
       -- ชนกันเมื่อชื่อต่างกันแต่ slug เหมือนกัน ("ครัว-ร้อน" กับ "ครัว ร้อน") → ต่อท้ายด้วย
       -- ลำดับ ไม่ใช่ทิ้งแถว เพราะทิ้งแถว = สถานีนั้นหายจากระบบ
       CASE WHEN dup = 1 THEN base_code ELSE LEFT(base_code, 28) || '_' || dup END,
       name, 0
  FROM coded
ON CONFLICT DO NOTHING;

-- ---- 3. ผูก id เข้ากับ "ผู้ใช้สถานี" ทั้งสามที่ ----------------------
--
-- ทุกคอลัมน์เป็น NULL ได้ และ **สตริงเดิมไม่ถูกลบ** — ช่วง compatibility อ่าน station_id
-- ก่อนแล้ว fallback ไปชื่อเดิม ถ้าลบสตริงทิ้งพร้อมกันในไมเกรชันเดียว โค้ดรุ่นเก่าที่ยัง
-- รันอยู่ระหว่าง deploy จะเห็นสถานีเป็น NULL ทั้งร้านทันที
ALTER TABLE bms_product_stock_policies
  ADD COLUMN IF NOT EXISTS kitchen_station_id UUID;
ALTER TABLE bms_kitchen_tickets
  ADD COLUMN IF NOT EXISTS station_id UUID;
ALTER TABLE bms_restaurant_kitchen_tickets
  ADD COLUMN IF NOT EXISTS station_id UUID;

UPDATE bms_product_stock_policies sp
   SET kitchen_station_id = st.id
  FROM bms_kitchen_stations st
 WHERE st.tenant_id = sp.tenant_id
   AND st.name = btrim(sp.kitchen_station)
   AND sp.kitchen_station_id IS NULL
   AND btrim(COALESCE(sp.kitchen_station, '')) <> '';

UPDATE bms_kitchen_tickets kt
   SET station_id = st.id
  FROM bms_kitchen_stations st
 WHERE st.tenant_id = kt.tenant_id
   AND st.name = btrim(kt.station)
   AND kt.station_id IS NULL
   AND btrim(COALESCE(kt.station, '')) <> '';

UPDATE bms_restaurant_kitchen_tickets rt
   SET station_id = st.id
  FROM bms_kitchen_stations st
 WHERE st.tenant_id = rt.tenant_id
   AND st.name = btrim(rt.station)
   AND rt.station_id IS NULL
   AND btrim(COALESCE(rt.station, '')) <> '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_product_stock_policies_kitchen_station_fk') THEN
    ALTER TABLE bms_product_stock_policies
      ADD CONSTRAINT bms_product_stock_policies_kitchen_station_fk
      FOREIGN KEY (tenant_id, kitchen_station_id)
      -- ลบสถานีถาวรทำไม่ได้จากแอป (ใช้ active = FALSE) แต่ถ้ามีคนลบตรงฐาน เมนูต้องไม่หาย
      -- ไปด้วย — คลายเป็น NULL แล้วเมนูตกไปช่อง "ไม่ระบุสถานี" ซึ่งยังขายได้
      REFERENCES bms_kitchen_stations(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_kitchen_tickets_station_fk') THEN
    ALTER TABLE bms_kitchen_tickets
      ADD CONSTRAINT bms_kitchen_tickets_station_fk
      FOREIGN KEY (tenant_id, station_id)
      -- ตั๋วที่เสียการอ้างอิงยังต้องขึ้นกระดานได้ด้วยชื่อ snapshot ของตัวเอง
      REFERENCES bms_kitchen_stations(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_restaurant_kitchen_tickets_station_fk') THEN
    ALTER TABLE bms_restaurant_kitchen_tickets
      ADD CONSTRAINT bms_restaurant_kitchen_tickets_station_fk
      FOREIGN KEY (tenant_id, station_id)
      REFERENCES bms_kitchen_stations(tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_product_stock_policies_station
  ON bms_product_stock_policies (tenant_id, kitchen_station_id)
  WHERE kitchen_station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_kitchen_tickets_station_id
  ON bms_kitchen_tickets (tenant_id, station_id, status, created_at)
  WHERE station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kitchen_tickets_station_id
  ON bms_restaurant_kitchen_tickets (tenant_id, station_id, status, created_at)
  WHERE station_id IS NOT NULL;

COMMENT ON COLUMN bms_kitchen_tickets.station IS
  'Station name snapshot taken when the ticket was queued (9.54). Renaming a station must not rewrite what the kitchen actually saw; station_id is the live reference.';
COMMENT ON COLUMN bms_restaurant_kitchen_tickets.station IS
  'Station name snapshot taken when the round was sent (9.54). See bms_kitchen_tickets.station.';
COMMENT ON COLUMN bms_product_stock_policies.kitchen_station IS
  'Legacy free-text station name, kept in sync with kitchen_station_id as a fallback for readers that predate 9.54. Write through the station master, not this column.';

-- ---- 4. RLS + GRANT (ตารางใหม่ไม่ได้อะไรมาโดยปริยาย) ----------------
ALTER TABLE bms_kitchen_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_kitchen_stations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_kitchen_stations_tenant_isolation ON bms_kitchen_stations;
CREATE POLICY bms_kitchen_stations_tenant_isolation ON bms_kitchen_stations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_kitchen_stations TO bms_app;

SELECT public.create_revision_trigger('bms_kitchen_stations');

COMMIT;
