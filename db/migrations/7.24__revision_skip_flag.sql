-- =============================================================
-- 7.24  revision trigger — รองรับ flag ข้าม snapshot (app.skip_revision)
-- -------------------------------------------------------------
-- การอัปเดต "ตัวนับเชิงปฏิบัติการ" (เช่น bms_coupons.redemptions_count ที่ +1
-- ทุกครั้งที่ใช้โค้ด / -1 ตอน order ถูก cancel/return) ไม่ใช่ "การแก้ไขโดยแอดมิน"
-- แต่ generic revision trigger เดิม snapshot ทุก UPDATE → หน้า Revision History
-- จะรก (count changes ปนกับการแก้ค่าจริง) และตารางบวมตามจำนวนออเดอร์
--
-- เพิ่ม guard: ถ้า session ตั้ง app.skip_revision = '1' ให้ trigger ข้าม (return NEW)
-- — เป็น opt-in ต่อ statement (set_config(...,true) ก่อน UPDATE แล้วรีเซ็ตทันที
-- หลัง UPDATE ในทรานแซกชันเดียวกัน) ใช้ได้กับทุกตารางที่มี revision trigger
-- default (ไม่ตั้ง flag) = พฤติกรรมเดิมทุกประการ
-- =============================================================

CREATE OR REPLACE FUNCTION public.trg_generic_revision() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_editor uuid;
  v_revision uuid;
  v_rev_table text := TG_TABLE_NAME || '_revisions';
  v_exists bool;
BEGIN
  -- ข้าม snapshot ถ้า statement นี้ตั้ง flag ไว้ (operational counter update)
  IF current_setting('app.skip_revision', true) = '1' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_editor := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_editor := NULL;
  END;

  BEGIN
    v_revision := NULLIF(current_setting('app.revision_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_revision := NULL;
  END;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = v_rev_table
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    EXECUTE
      'INSERT INTO ' || quote_ident(v_rev_table) ||
      ' (id, tenant_id, editor_id, revision_id, snapshot, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())'
    USING OLD.tenant_id, v_editor, v_revision, to_jsonb(OLD);
  END IF;

  RETURN NEW;
END;
$$;
