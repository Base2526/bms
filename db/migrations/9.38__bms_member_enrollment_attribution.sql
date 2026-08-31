-- =============================================================
-- 9.38 — Member enrollment branch/device/shift attribution
-- =============================================================

-- สาขาที่ลูกค้าเคยซื้อไม่ใช่หลักฐานว่าสมัครสมาชิกที่สาขาใด จึงเก็บต้นทาง
-- การสมัครครั้งแรกไว้บน customer โดยตรง แถวเก่าคง NULL เพื่อไม่แต่งข้อมูลย้อนหลัง
ALTER TABLE bms_customers
  ADD COLUMN IF NOT EXISTS enrollment_channel TEXT,
  ADD COLUMN IF NOT EXISTS enrolled_location_id UUID,
  ADD COLUMN IF NOT EXISTS enrolled_pos_device_id UUID,
  ADD COLUMN IF NOT EXISTS enrolled_shift_id UUID,
  ADD COLUMN IF NOT EXISTS enrolled_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_devices_tenant_id
  ON bms_pos_devices(tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_shifts_tenant_id
  ON bms_pos_shifts(tenant_id, id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_enrolled_location_fk'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_enrolled_location_fk
      FOREIGN KEY (tenant_id, enrolled_location_id)
      REFERENCES bms_locations(tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_enrolled_pos_device_fk'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_enrolled_pos_device_fk
      FOREIGN KEY (tenant_id, enrolled_pos_device_id)
      REFERENCES bms_pos_devices(tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_enrolled_shift_fk'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_enrolled_shift_fk
      FOREIGN KEY (tenant_id, enrolled_shift_id)
      REFERENCES bms_pos_shifts(tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_enrolled_by_fk'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_enrolled_by_fk
      FOREIGN KEY (enrolled_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_enrollment_channel_check'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_enrollment_channel_check
      CHECK (enrollment_channel IS NULL OR enrollment_channel IN ('POS', 'ADMIN', 'ONLINE', 'IMPORT'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_customers_pos_enrollment_origin_check'
       AND conrelid = 'bms_customers'::regclass
  ) THEN
    ALTER TABLE bms_customers
      ADD CONSTRAINT bms_customers_pos_enrollment_origin_check
      CHECK (
        enrollment_channel IS NULL
        OR enrollment_channel <> 'POS'
        OR (enrolled_location_id IS NOT NULL AND enrolled_pos_device_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_customers_enrolled_location
  ON bms_customers(tenant_id, enrolled_location_id, member_since DESC)
  WHERE enrolled_location_id IS NOT NULL;

COMMENT ON COLUMN bms_customers.enrollment_channel IS
  'ช่องทางที่สมัครสมาชิกครั้งแรก: POS, ADMIN, ONLINE หรือ IMPORT; NULL คือข้อมูลเดิมที่ไม่ทราบต้นทาง';
COMMENT ON COLUMN bms_customers.enrolled_location_id IS
  'สาขาที่รับสมัครสมาชิกจริง ไม่อนุมานจากสาขาของออเดอร์แรก';
COMMENT ON COLUMN bms_customers.enrolled_pos_device_id IS
  'เครื่อง POS ที่รับสมัครสมาชิก มาจาก device token ฝั่ง server';
COMMENT ON COLUMN bms_customers.enrolled_shift_id IS
  'กะที่เปิดอยู่บนเครื่องขณะสมัคร ถ้าไม่มีกะเปิดจะเป็น NULL';
COMMENT ON COLUMN bms_customers.enrolled_by IS
  'พนักงานที่ยืนยัน PIN หรือผู้ใช้แอดมินที่ทำรายการสมัคร';
