-- =============================================================
-- 9.64  บัตรคิวหน้าร้าน + จองโต๊ะล่วงหน้า (walk-in queue & reservations)
-- -------------------------------------------------------------
-- ร้านอาหารที่โต๊ะเต็มมีคนรออยู่เสมอ และร้านที่รับจองมีคนโทรมาจองทุกวัน · ก่อนไฟล์นี้
-- ระบบไม่มีที่เก็บ "คนที่ยังไม่มีโต๊ะ" เลย ร้านจึงจดใส่กระดาษข้างเครื่องคิดเงิน ผลคือ
-- ไม่มีใครตอบได้ว่ารออยู่กี่คิว รอมานานแค่ไหน หรือคิวไหนถูกเรียกไปแล้ว — และเวลารอ
-- คือตัวเลขที่ตัดสินว่าลูกค้าจะอยู่ต่อหรือเดินออก
--
-- ทำไมตารางเดียว ไม่ใช่ "คิว" กับ "จอง" แยกกัน
-- -------------------------------------------------------------
-- ทั้งสองอย่างคือ **ปาร์ตี้ที่ยังไม่มีโต๊ะ** ต่างกันแค่ว่ารู้ล่วงหน้าหรือไม่ · สิ่งที่เกิดตอน
-- "ได้โต๊ะ" เหมือนกันทุกประการ (เลือกโต๊ะว่าง → เปิดบิล → ผูกกลับมาที่แถวนี้) และนั่นคือ
-- ส่วนที่แตะบิลโต๊ะจริง · แยกสองตารางแปลว่ามีเส้นทาง "พาไปนั่ง" สองชุดที่ต้อง drift กัน
-- ในวันที่กฎเปลี่ยน · ความต่างที่แท้จริงอยู่ที่สองคอลัมน์ (`queue_no` กับ `reserved_for`)
-- ซึ่ง CHECK บังคับรูปทรงไว้แล้ว
--
-- เลขคิวรีเซ็ตตาม "วันบริการ" ไม่ใช่เที่ยงคืน
-- -------------------------------------------------------------
-- `service_date` ถูกคำนวณ **ฝั่ง server** จากเขตเวลาของร้าน (`bms_store_profile.timezone`)
-- แล้วเก็บไว้ตรง ๆ · เก็บไว้เพราะเลขคิวต้องไม่ซ้ำในวันเดียวกัน และการคำนวณ "วันไหน" ใหม่
-- ทุกครั้งที่ query จะทำให้ unique index ทำงานไม่ได้ · ร้านที่เปิดข้ามเที่ยงคืนจึงได้เลขคิว
-- เดินต่อจนถึงรอบปิดร้าน ไม่ใช่กลับไปเป็น 1 ตอนตี 12 ต่อหน้าคนที่ยังนั่งรออยู่
--
-- ไม่มี permission ใหม่ — ใช้ `pos.sell` เหมือนการเปิดโต๊ะและย้ายโต๊ะ
-- (การรับคิว/พาไปนั่งไม่ขยับเงินหรือสต็อก · จังหวะที่ขยับคือ "เปิดบิล" ซึ่งกันด้วย
-- `pos.sell` อยู่แล้ว) การเพิ่ม permission ใหม่แปลว่าทุกร้านที่อัปเกรดต้องไป seed สิทธิ์
-- ก่อนเจ้าหน้าที่หน้าร้านจะกดปุ่มได้ ซึ่งเป็นราคาที่ไม่ได้ซื้ออะไรเลย
--
-- ROLLBACK:  DROP TABLE IF EXISTS bms_restaurant_waitlist;
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_restaurant_waitlist (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id        UUID NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('WALK_IN', 'RESERVATION')),
  status             TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN (
    'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'
  )),
  -- วันบริการที่แถวนี้เป็นของ (เขตเวลาของร้าน) — คีย์ของเลขคิว
  service_date       DATE NOT NULL,
  queue_no           INTEGER CHECK (queue_no IS NULL OR queue_no > 0),
  reserved_for       TIMESTAMPTZ,
  party_size         INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 500),
  guest_name         TEXT CHECK (guest_name IS NULL OR length(btrim(guest_name)) BETWEEN 1 AND 120),
  guest_phone        TEXT CHECK (guest_phone IS NULL OR length(btrim(guest_phone)) BETWEEN 1 AND 40),
  note               TEXT CHECK (note IS NULL OR length(note) <= 300),
  preferred_table_id UUID,
  seated_table_id    UUID,
  check_id           UUID,
  created_by         UUID NOT NULL REFERENCES users(id),
  updated_by         UUID REFERENCES users(id),
  called_at          TIMESTAMPTZ,
  seated_at          TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, preferred_table_id)
    REFERENCES bms_restaurant_tables(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, seated_table_id)
    REFERENCES bms_restaurant_tables(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, check_id)
    REFERENCES bms_restaurant_checks(tenant_id, id) ON DELETE SET NULL,
  -- คิวเดินเข้ามีเลขคิว · การจองมีเวลานัด — อย่างละหนึ่งเสมอ ไม่ใช่ทั้งคู่หรือไม่มีเลย
  CONSTRAINT bms_restaurant_waitlist_kind_shape CHECK (
    (kind = 'WALK_IN') = (queue_no IS NOT NULL)
    AND (kind = 'RESERVATION') = (reserved_for IS NOT NULL)
  ),
  -- "พาไปนั่งแล้ว" ต้องบอกได้ว่าโต๊ะไหนและบิลใบไหน ไม่งั้นเวลารอที่วัดได้ก็ไม่มีปลายทาง
  CONSTRAINT bms_restaurant_waitlist_seated_shape CHECK (
    (status = 'SEATED') = (seated_at IS NOT NULL)
    AND (status <> 'SEATED' OR (seated_table_id IS NOT NULL AND check_id IS NOT NULL))
  ),
  CONSTRAINT bms_restaurant_waitlist_closed_shape CHECK (
    (status IN ('SEATED', 'CANCELLED', 'NO_SHOW')) = (closed_at IS NOT NULL)
  )
);

-- เลขคิวไม่ซ้ำในวันบริการเดียวกันของสาขาเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_waitlist_queue_no
  ON bms_restaurant_waitlist (tenant_id, location_id, service_date, queue_no)
  WHERE queue_no IS NOT NULL;

-- กระดานคิวอ่านเฉพาะแถวที่ยังรออยู่ และเรียงตามลำดับที่ควรได้โต๊ะ
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_waitlist_open
  ON bms_restaurant_waitlist (tenant_id, location_id, status, created_at)
  WHERE status IN ('WAITING', 'CALLED');
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_waitlist_day
  ON bms_restaurant_waitlist (tenant_id, location_id, service_date, created_at);

ALTER TABLE bms_restaurant_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_restaurant_waitlist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_restaurant_waitlist_tenant_isolation ON bms_restaurant_waitlist;
CREATE POLICY bms_restaurant_waitlist_tenant_isolation ON bms_restaurant_waitlist
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_restaurant_waitlist TO bms_app;

SELECT public.create_revision_trigger('bms_restaurant_waitlist');

COMMENT ON TABLE bms_restaurant_waitlist IS
  'Parties without a table yet: walk-in queue tickets and advance reservations in one list, because '
  'seating them is the same action. Seating opens a normal dine-in check and links it back here, so '
  'the wait a shop actually delivered is measurable instead of remembered.';
COMMENT ON COLUMN bms_restaurant_waitlist.service_date IS
  'Service day in the shop timezone, stamped server-side. Queue numbers are unique per branch per '
  'service day, so a shop open past midnight keeps counting instead of restarting at 1 in front of '
  'people who are still waiting.';
