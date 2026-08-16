-- =============================================================
-- 7.87  BMS POS — เครื่องขาย, กะ/ลิ้นชักเงินสด, ร่องรอยคนขาย
-- -------------------------------------------------------------
-- ต้องรัน 7.84 ก่อน (ใช้ bms_locations)
--
-- หลักการ:
--   • "กะ" ผูกกับ **เครื่อง/ลิ้นชัก** ไม่ใช่คน — เงินอยู่ในลิ้นชัก ไม่ได้อยู่กับคน
--     ร้านมีพนักงาน 10 คนต่อกะ หมุนเวียนหลายเครื่อง ถ้าผูกกะกับคนจะนับเงินไม่ได้
--   • "ใครขาย" บันทึกราย **บิล** → ตอบได้ว่าเงินขาดมาจากกะไหน เครื่องไหน บิลไหน
--   • เภสัชกรเวรผูกที่กะ (ตัวเลือก ค) — ไม่ได้ให้สิทธิ์ข้ามการตรวจใด ๆ
--     เป็นแค่การบันทึกว่าใครรับผิดชอบหน้าร้านช่วงนั้น
--
-- ⚠️ สิ่งที่ migration นี้ **ไม่** ทำ: ไม่ผ่อนปรนกฎการขายยาใด ๆ ทั้งสิ้น
--    evaluatePharmacySale() ยังเป็นประตูเดียวและยังตัดสินเหมือนเดิมทุกช่องทาง
--
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. เครื่องขาย ---------------------------------------------------
CREATE TABLE IF NOT EXISTS bms_pos_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES bms_locations(id),
  code              TEXT NOT NULL,                    -- รหัสภายใน เช่น POS-01
  name              TEXT,

  -- เลขทะเบียนเครื่องที่พิมพ์บนใบกำกับภาษี (ช่อง "POS #")
  registered_pos_no TEXT,
  -- prefix เลขใบเสร็จ/ใบกำกับอย่างย่อของเครื่องนี้ (เลขต้องรันแยกต่อเครื่อง)
  receipt_prefix    TEXT,
  receipt_seq       BIGINT NOT NULL DEFAULT 0 CHECK (receipt_seq >= 0),

  -- token ประจำเครื่อง — เก็บเฉพาะ hash ห้ามเก็บค่าจริง
  token_hash        TEXT,
  token_issued_at   TIMESTAMPTZ,

  active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_devices_location
  ON bms_pos_devices (tenant_id, location_id) WHERE active;

-- ---- 2. กะ / ลิ้นชักเงินสด -------------------------------------------
CREATE TABLE IF NOT EXISTS bms_pos_shifts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES bms_locations(id),
  device_id           UUID NOT NULL REFERENCES bms_pos_devices(id),

  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),

  opened_by           UUID NOT NULL REFERENCES users(id),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),

  -- เภสัชกรผู้มีหน้าที่ปฏิบัติการประจำกะนี้
  -- ⚠️ ต้องเป็น users.is_licensed_pharmacist = TRUE — บังคับที่ service layer
  --    (ไม่ใช้ trigger เพราะชื่อฟังก์ชัน trigger เป็น global namespace ในฐานนี้)
  pharmacist_user_id  UUID REFERENCES users(id),

  closed_by           UUID REFERENCES users(id),
  closed_at           TIMESTAMPTZ,
  expected_cash       NUMERIC(12,2),                  -- float + ขายเงินสด − ทอน
  counted_cash        NUMERIC(12,2),                  -- ที่นับได้จริงตอนปิด
  cash_variance       NUMERIC(12,2)
                        GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  note                TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (status = 'OPEN' OR closed_at IS NOT NULL)
);

-- 1 เครื่อง เปิดกะค้างได้ทีละกะเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_shifts_open_per_device
  ON bms_pos_shifts (tenant_id, device_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_bms_pos_shifts_location
  ON bms_pos_shifts (tenant_id, location_id, opened_at DESC);

-- ---- 3. ร่องรอยบน order ---------------------------------------------
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS pos_device_id        UUID REFERENCES bms_pos_devices(id),
  ADD COLUMN IF NOT EXISTS pos_shift_id         UUID REFERENCES bms_pos_shifts(id),
  ADD COLUMN IF NOT EXISTS cashier_user_id      UUID REFERENCES users(id),
  -- ส่วนลดต้องให้หัวหน้าอนุมัติ — เก็บว่าใครอนุมัติและเพราะอะไร
  ADD COLUMN IF NOT EXISTS discount_approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS discount_reason      TEXT,
  -- เครื่องสร้างเอง: {device}-{shift}-{seq} — กันบิลซ้ำตอนเน็ตสะดุดกลางคำขอ
  -- (จำเป็นแม้จะไม่ทำโหมดออฟไลน์ เพราะ response หายระหว่างทางได้)
  ADD COLUMN IF NOT EXISTS idempotency_key      TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_orders_idempotency
  ON bms_orders (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_orders_shift
  ON bms_orders (tenant_id, pos_shift_id) WHERE pos_shift_id IS NOT NULL;

-- ---- 4. เงินรับมา / เงินทอน + วิธีชำระเงินที่ขาด ---------------------
ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS cash_tendered NUMERIC(12,2)
    CHECK (cash_tendered IS NULL OR cash_tendered >= 0),
  ADD COLUMN IF NOT EXISTS cash_change   NUMERIC(12,2)
    CHECK (cash_change IS NULL OR cash_change >= 0);

-- e-wallet (ทรูมันนี่ / ShopeePay / Rabbit LINE Pay) ยังไม่มีใน CHECK เดิม
ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET'));

-- ---- 5. RLS (copy 4.2) ----------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_pos_devices','bms_pos_shifts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;

-- ---- 6. GRANT (copy 4.3) --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_devices, bms_pos_shifts TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 7. seed สิทธิ์ให้ทุก role ทุกร้าน (ไม่ seed ร้านจะโดน 403 เงียบ ๆ) ----
-- Administrator เป็น super ในโค้ดอยู่แล้ว ไม่ต้อง seed
--
-- pharmacy.policy.review ให้เฉพาะ Pharmacist — การจัดประเภทยาเป็นการตัดสินใจ
-- เชิงกำกับดูแล ตามแนวเดียวกับ 7.57 ที่ Manager ได้แต่ฝั่ง config/read
-- และโค้ดยังต้องเช็ค users.is_licensed_pharmacist ซ้ำอีกชั้น
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.sell'),
  ('Manager','pos.shift.open'),
  ('Manager','pos.shift.close'),
  ('Manager','pos.discount.approve'),
  ('Manager','pos.device.manage'),
  ('Manager','pharmacy.policy.read'),

  ('Sales','pos.sell'),
  ('Sales','pos.shift.open'),
  ('Sales','pos.shift.close'),

  ('Pharmacist','pos.sell'),
  ('Pharmacist','pos.shift.open'),
  ('Pharmacist','pos.shift.close'),
  ('Pharmacist','pharmacy.policy.read'),
  ('Pharmacist','pharmacy.policy.review')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
