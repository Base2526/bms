-- =============================================================
-- 9.63  แยกบิล / รวมบิล ของโต๊ะ (split & merge dine-in checks)
-- -------------------------------------------------------------
-- 9.44 ตั้งกติกาไว้ว่า "หนึ่งโต๊ะ = หนึ่งบิลที่เปิดอยู่" ผ่าน partial unique index
-- `uq_bms_restaurant_checks_open_table (tenant_id, table_id)` ซึ่งถูกสำหรับร้านที่เพิ่ง
-- เริ่ม แต่ปิดสองงานที่ร้านอาหารไทยทำทุกวัน:
--
--   1. **แยกบิล** — โต๊ะเดียวกันขอจ่ายแยกกัน (เพื่อนร่วมงานกินข้าวเที่ยงแล้วแยกจ่าย)
--      ทางเดียวที่ทำได้ก่อนหน้านี้คือคิดเงินทั้งโต๊ะแล้วให้คนหนึ่งไปเก็บกับเพื่อนเอง
--   2. **รวมบิล** — สองโต๊ะที่นั่งแยกกันแล้วขอจ่ายใบเดียว (โต๊ะเต็มเลยแยกกันนั่งก่อน)
--      ก่อนหน้านี้ต้องยกเลิกบิลหนึ่งใบแล้วสั่งใหม่ทั้งหมด ซึ่งทิ้งบิล void ที่อธิบายไม่ได้
--      และต้องให้ผู้มีสิทธิ์ pos.void คนที่สองมากดอนุมัติทั้งที่ไม่มีอาหารถูกทิ้งสักจาน
--
-- สิ่งที่เพิ่ม
-- -------------------------------------------------------------
-- * `split_group_no` — บิลใบที่เท่าไรของโต๊ะนั้น (1 = บิลหลัก) · แถวเดิมทุกแถวได้ 1
--   จึงรักษาความหมายเดิมของ index ไว้เป๊ะ ๆ (โต๊ะหนึ่งมีบิลหลักได้ใบเดียว) แล้วเปิดให้
--   บิลที่ 2, 3 อยู่บนโต๊ะเดียวกันได้
-- * `split_from_check_id` / `merged_into_check_id` — สายเลือดของบิล
--   "บิลใบนี้มาจากไหน / ไปไหนต่อ" คือคำถามแรกเวลาบัญชีมาไล่ว่าทำไมโต๊ะเดียวมีสองใบ
-- * สถานะ **`MERGED`** เป็นสถานะปลายทางตัวที่สาม
--
-- ทำไมต้องมีสถานะใหม่ ไม่ใช้ CANCELLED
-- -------------------------------------------------------------
-- บิลต้นทางของการรวมบิล **ไม่ใช่บิลที่ถูกยกเลิก** — ไม่มีอาหารถูกทิ้ง ไม่มีเงินหาย
-- รายการทุกบรรทัดย้ายไปอยู่อีกใบและยังถูกเก็บเงินครบ · ถ้าใช้ CANCELLED:
--   - รายงาน/การไล่ตรวจที่นับบิลที่ถูกยกเลิกจะพองขึ้นตามจำนวนครั้งที่ร้านรวมบิล
--     ซึ่งเป็นตัวเลขที่โกหกคนอ่าน (ร้านที่รวมบิลบ่อยจะดูเหมือนร้านที่ void บ่อย)
--   - `cancelRestaurantCheck()` บังคับผู้อนุมัติคนที่สองเมื่อบิลส่งครัวแล้ว ซึ่งถูกสำหรับ
--     การ void แต่ผิดสำหรับการรวมบิล (จะกลายเป็นการตามหัวหน้ามากด PIN ทุกครั้งที่
--     ลูกค้าขอรวมบิล = ร้านจะเลิกใช้แล้วกลับไปคิดเงินแยกในหัว)
--
-- CHECK ของ closed_at จึงขยายเป็นสามค่า และ trigger ของ 9.62 (หมดอายุ QR ตอนบิลถึง
-- สถานะปลายทาง) ต้องรู้จัก MERGED ด้วย มิฉะนั้น session ของโทรศัพท์ลูกค้าที่โต๊ะต้นทาง
-- จะยังยิงคำขอเข้าบิลที่ปิดไปแล้วได้ตลอดไป
--
-- ไม่มี permission ใหม่ — แยกบิล/รวมบิลเป็นงานของคนที่มี `pos.sell` เหมือนการย้ายโต๊ะ
-- (ทั้งสองอย่างไม่ทำให้เงินหรือสต็อกหายไปจากระบบ แค่ย้ายว่าใครจ่ายใบไหน) การยกเลิกบิล
-- ยังบังคับผู้อนุมัติคนที่สองเหมือนเดิม ไฟล์นี้ไม่แตะ
--
-- ROLLBACK (ทำได้ก็ต่อเมื่อยังไม่มีแถวไหนสถานะ MERGED และไม่มีโต๊ะไหนมีบิลเปิดเกินหนึ่งใบ):
--   DROP INDEX IF EXISTS uq_bms_restaurant_checks_open_table;
--   CREATE UNIQUE INDEX uq_bms_restaurant_checks_open_table
--     ON bms_restaurant_checks (tenant_id, table_id)
--     WHERE status IN ('OPEN','CLOSING');
--   ALTER TABLE bms_restaurant_checks
--     DROP COLUMN IF EXISTS split_group_no,
--     DROP COLUMN IF EXISTS split_from_check_id,
--     DROP COLUMN IF EXISTS merged_into_check_id;
--   -- แล้วคืน CHECK ของ status/closed_at เป็นสองค่าเดิม และ trigger ของ 9.62
-- =============================================================

ALTER TABLE bms_restaurant_checks
  ADD COLUMN IF NOT EXISTS split_group_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS split_from_check_id UUID,
  ADD COLUMN IF NOT EXISTS merged_into_check_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_split_group_no_range'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_split_group_no_range
      CHECK (split_group_no BETWEEN 1 AND 20);
  END IF;
END $$;

-- สายเลือดของบิลต้องอยู่ในร้านเดียวกันเสมอ (FK แบบ composite ตามแบบของทั้งโมดูล)
--
-- ON DELETE SET NULL โดยตั้งใจ: แถวในตารางนี้ถูกลบทางเดียวคือ tenant ถูกลบทั้งร้าน
-- (`ON DELETE CASCADE` จาก bms_tenants) ถ้าใช้ NO ACTION การลบร้านจะล้มเพราะแถวใน
-- ตารางเดียวกันอ้างกันเอง
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_split_from_fk'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_split_from_fk
      FOREIGN KEY (tenant_id, split_from_check_id)
      REFERENCES bms_restaurant_checks (tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_merged_into_fk'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_merged_into_fk
      FOREIGN KEY (tenant_id, merged_into_check_id)
      REFERENCES bms_restaurant_checks (tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

-- บิลรวมเข้าตัวเองไม่ได้ · และบิลที่ยังไม่ได้ถูกรวมต้องไม่อ้างปลายทางค้างไว้
--
-- ตั้งใจตรวจ **ทางเดียว** (มีปลายทาง ⇒ ต้องเป็น MERGED) ไม่ใช่สองทาง เพราะ
-- ON DELETE SET NULL ข้างบนจะทำให้แถว MERGED กลายเป็นปลายทางว่างได้ตอนลบร้าน
-- แล้ว CHECK สองทางจะทำให้การลบร้านล้ม ซึ่งเป็นราคาที่แพงกว่าประโยชน์ที่ได้
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_merge_shape'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_merge_shape
      CHECK (
        merged_into_check_id IS DISTINCT FROM id
        AND split_from_check_id IS DISTINCT FROM id
        AND (merged_into_check_id IS NULL OR status = 'MERGED')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------
-- ขยาย CHECK ของ status และของ closed_at ให้รู้จัก MERGED
--
-- ⚠️ หาชื่อ constraint จาก pg_constraint ไม่ใช่เดาจากชื่อ — 9.44 ประกาศแบบไม่ตั้งชื่อ
-- ชื่อจริงจึงมาจาก Postgres และอาจต่างกันได้ระหว่างฐานที่สร้างคนละรอบ · กรองด้วย
-- จำนวนคอลัมน์ใน conkey ด้วย (บทเรียนของ 9.52) ไม่งั้น DROP โดนตัวผิดเงียบ ๆ:
-- ตารางนี้มี CHECK ที่เอ่ยถึง status อยู่ **สามตัว** (status ล้วน / status+closed_at /
-- settlement_claim_shape ซึ่งอ้าง status + settlement_attempt_id + settlement_started_at)
-- ---------------------------------------------------------------
DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND contype = 'c'
       AND array_length(conkey, 1) = 1
       AND conkey[1] = (
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'bms_restaurant_checks'::regclass AND attname = 'status'
       )
       AND pg_get_constraintdef(oid) LIKE '%CLOSING%'
  LOOP
    EXECUTE format('ALTER TABLE bms_restaurant_checks DROP CONSTRAINT %I', target);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_status_check'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_status_check
      CHECK (status IN ('OPEN', 'CLOSING', 'PAID', 'CANCELLED', 'MERGED'));
  END IF;
END $$;

DO $$
DECLARE
  target text;
  status_attnum smallint := (
    SELECT attnum FROM pg_attribute
     WHERE attrelid = 'bms_restaurant_checks'::regclass AND attname = 'status'
  );
  closed_attnum smallint := (
    SELECT attnum FROM pg_attribute
     WHERE attrelid = 'bms_restaurant_checks'::regclass AND attname = 'closed_at'
  );
BEGIN
  FOR target IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND contype = 'c'
       AND array_length(conkey, 1) = 2
       AND status_attnum = ANY(conkey)
       AND closed_attnum = ANY(conkey)
  LOOP
    EXECUTE format('ALTER TABLE bms_restaurant_checks DROP CONSTRAINT %I', target);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_restaurant_checks'::regclass
       AND conname = 'bms_restaurant_checks_closed_at_shape'
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_closed_at_shape
      CHECK ((status IN ('PAID', 'CANCELLED', 'MERGED')) = (closed_at IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------
-- โต๊ะหนึ่งมีบิลที่เปิดอยู่ได้หลายใบ แต่เลขใบต้องไม่ซ้ำกัน
--
-- บิลหลักของโต๊ะ = ใบที่ split_group_no น้อยที่สุดในบรรดาใบที่ยังเปิดอยู่ ไม่ต้องมีธง
-- `is_primary` ให้ต้องคอยดูแล — บิลหลักถูกคิดเงินไปแล้ว ใบถัดไปเลื่อนขึ้นมาเป็นหลักเอง
-- ---------------------------------------------------------------
DROP INDEX IF EXISTS uq_bms_restaurant_checks_open_table;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_checks_open_table
  ON bms_restaurant_checks (tenant_id, table_id, split_group_no)
  WHERE status IN ('OPEN', 'CLOSING');

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_checks_merged_into
  ON bms_restaurant_checks (tenant_id, merged_into_check_id)
  WHERE merged_into_check_id IS NOT NULL;

-- ---------------------------------------------------------------
-- trigger ของ 9.62 ต้องนับ MERGED เป็นสถานะปลายทางด้วย
--
-- บิลต้นทางที่ถูกรวมไปแล้วคือบิลที่ปิดถาวร · ถ้า trigger ไม่รู้จัก โทรศัพท์ของลูกค้าที่
-- โต๊ะต้นทางจะยังถือ session ที่ชี้ไปบิลนั้นและยิงคำขอเข้าไปได้เรื่อย ๆ โดยไม่มีใครเห็น
-- (กล่องขาเข้าอ่านจากบิล ไม่ใช่จาก session) — อาการเดียวกับที่ 9.62 เพิ่งปิดไป
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- ⚠️ ห้ามเขียนเป็น "NEW.status <> 'OPEN'" — CLOSING คือการ *เริ่ม* คิดเงินซึ่งย้อนกลับได้
  -- สามค่านี้คือสถานะปลายทางที่ย้อนไม่ได้ ตรงกับ CHECK ของ closed_at
  IF NEW.status IN ('PAID', 'CANCELLED', 'MERGED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE bms_restaurant_qr_sessions
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND revoked_at IS NULL;
    UPDATE bms_restaurant_qr_submissions
       SET status = 'EXPIRED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND status = 'PENDING';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION bms_expire_restaurant_qr_on_check_close() IS
  'Expires table QR sessions and unreviewed customer proposals when a dine-in check reaches a '
  'terminal status (PAID / CANCELLED / MERGED). CLOSING is a reversible settlement claim (9.48) '
  'and deliberately does nothing.';

COMMENT ON COLUMN bms_restaurant_checks.split_group_no IS
  'Bill number within one table (1 = primary). Lets one table carry several open checks so a '
  'party can split the bill; the primary is simply the lowest number still open.';
COMMENT ON COLUMN bms_restaurant_checks.split_from_check_id IS
  'Check this one was split out of. Answers "why does this table have two bills".';
COMMENT ON COLUMN bms_restaurant_checks.merged_into_check_id IS
  'Check that absorbed this one. Set together with status MERGED, which is NOT a void: no food '
  'was thrown away and every line is still being charged on the target check.';
