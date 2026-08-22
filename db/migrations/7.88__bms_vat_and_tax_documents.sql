-- =============================================================
-- 7.88  BMS VAT + ใบกำกับภาษี (อย่างย่อ / เต็มรูป / ใบลดหนี้)
-- -------------------------------------------------------------
-- ต้องรัน 7.84 (bms_locations) และ 7.87 (bms_pos_devices) ก่อน
--
-- โครงนี้ถอดมาจากใบกำกับจริง 4 ใบ (วราภรณ์ / KFC / Makro / 7-Eleven):
--
--  1. VAT เป็นเรื่องของ "สินค้า" ไม่ใช่ของบิล — ใบ Makro มีทั้ง V (7%) และ N
--     (ยกเว้น) ในบิลเดียว ร้านของชำ/ร้านข้าวเจอแน่นอนเพราะข้าวสารกับผักสด
--     ยกเว้น VAT ส่วนน้ำปลากับมาม่าไม่ยกเว้น
--  2. ราคารวม VAT หรือไม่ ขึ้นกับร้าน — วราภรณ์/Makro รวมแล้ว, KFC แยก
--  3. เลขเอกสารไม่มีรูปแบบมาตรฐาน — เจอมาแล้ว 2512010004 / KFC2522205 /
--     E0503620250222000242 / 006/8731 → เก็บเป็น TEXT ห้ามบังคับรูปแบบ
--  4. ใบย่อกับใบเต็มเดินคนละชุดเลข และใบเต็ม "ยกเลิกใบย่อแล้วออกใหม่แทน"
--     ทุกใบที่ดูมามีข้อความนี้หมด → เป็นมาตรฐาน ไม่ใช่ทางเลือก
--  5. ใบย่อไม่ต้องแยกยอด VAT — แค่เขียน "VAT Included" ที่หัวและติดธง N
--     รายบรรทัด · ใบเต็มต้องแยก ฐาน/VAT/รวม ต่อกลุ่ม
--
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. VAT รายสินค้า ------------------------------------------------
-- V = เสียภาษี · N = ยกเว้น/อัตรา 0 · UNKNOWN = ยังไม่ระบุ (ต้องระบุก่อนออกใบกำกับ)
ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS vat_category TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (vat_category IN ('V', 'N', 'UNKNOWN')),
  -- ชื่อสั้นสำหรับพิมพ์ใบเสร็จกระดาษ 58/80mm — ชื่อไทยเต็มพิมพ์ไม่ลง
  -- (ใบ 7-Eleven ตัด "Delivery Service" เหลือ "Delivery Servi")
  ADD COLUMN IF NOT EXISTS receipt_name TEXT;

-- ---- 2. ค่าตั้งภาษีของร้าน -------------------------------------------
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS vat_registered      BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE = ราคาใน bms_products รวม VAT แล้ว (แบบวราภรณ์/Makro)
  -- FALSE = ราคายังไม่รวม ต้องบวกตอนออกบิล (แบบ KFC)
  ADD COLUMN IF NOT EXISTS price_includes_vat  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS vat_rate            NUMERIC(5,2) NOT NULL DEFAULT 7.00
    CHECK (vat_rate >= 0 AND vat_rate <= 100),
  -- ปฏิทินบนเอกสาร: Makro ใช้ พ.ศ. อีกสองเจ้าใช้ ค.ศ.
  ADD COLUMN IF NOT EXISTS calendar_era        TEXT NOT NULL DEFAULT 'BE'
    CHECK (calendar_era IN ('BE', 'CE')),
  -- ใบกำกับอย่างย่อต้องได้รับอนุมัติจากสรรพากรก่อนใช้จริง
  ADD COLUMN IF NOT EXISTS abbreviated_tax_invoice_approved BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- 3. ยอดแยกกลุ่ม VAT บนบิล ---------------------------------------
-- taxable_amount / exempt_amount เป็นยอด "รวม VAT แล้ว" ทั้งคู่ (ตามที่พิมพ์บนใบ)
-- ฐานก่อน VAT = taxable_amount − vat_amount + exempt_amount
ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS taxable_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exempt_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- "ยอดเงินปัดเศษ" ที่เห็นบนใบวราภรณ์ — ปัดสตางค์ตอนรับเงินสด
  ADD COLUMN IF NOT EXISTS rounding_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- snapshot ต่อบรรทัด เพราะประเภท VAT ของสินค้าเปลี่ยนทีหลังได้
-- แต่ใบที่ออกไปแล้วต้องอ่านได้เหมือนวันที่พิมพ์
ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS vat_category TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (vat_category IN ('V', 'N', 'UNKNOWN'));

-- ---- 4. ตัวนับเลขเอกสาร ---------------------------------------------
-- เลขต้องเรียง ห้ามข้าม ห้ามซ้ำ ต่อ (สาขา, ชนิดเอกสาร, งวด)
-- ใบย่อรันต่อ "เครื่อง" (device_id) · ใบเต็มรันต่อ "สาขา" (device_id = NULL)
-- period_key ให้ผู้เรียกกำหนด เช่น '2569' หรือ '256908' หรือ '' (ไม่รีเซ็ต)
CREATE TABLE IF NOT EXISTS bms_document_counters (
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES bms_locations(id) ON DELETE CASCADE,
  device_id   UUID REFERENCES bms_pos_devices(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('ABBREVIATED', 'FULL', 'CREDIT_NOTE')),
  period_key  TEXT NOT NULL DEFAULT '',
  next_seq    BIGINT NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- device_id เป็น NULL ได้ → ต้องใช้ unique index 2 ตัวแทน PK เดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_document_counters_device
  ON bms_document_counters (tenant_id, location_id, device_id, doc_type, period_key)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_document_counters_location
  ON bms_document_counters (tenant_id, location_id, doc_type, period_key)
  WHERE device_id IS NULL;

-- ---- 5. เอกสารภาษีที่ออกไปแล้ว --------------------------------------
CREATE TABLE IF NOT EXISTS bms_tax_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id          UUID NOT NULL REFERENCES bms_locations(id),
  order_id             UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  device_id            UUID REFERENCES bms_pos_devices(id),

  doc_type             TEXT NOT NULL CHECK (doc_type IN ('ABBREVIATED', 'FULL', 'CREDIT_NOTE')),
  doc_no               TEXT NOT NULL,           -- รูปแบบอิสระ ตั้งต่อร้าน
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,

  -- ใบเต็มที่ออกแทนใบย่อ ชี้กลับไปที่ใบย่อที่ถูกยกเลิก
  replaces_document_id UUID REFERENCES bms_tax_documents(id),
  cancelled_at         TIMESTAMPTZ,
  cancelled_reason     TEXT,

  -- snapshot ผู้ซื้อ ณ วันที่ออก (ลูกค้าแก้โปรไฟล์ทีหลังไม่กระทบใบที่ออกไปแล้ว)
  buyer_name           TEXT,
  buyer_tax_id         TEXT,
  buyer_branch_code    TEXT,                    -- "สำนักงานใหญ่" = 00000
  buyer_address        TEXT,
  buyer_phone          TEXT,

  -- snapshot ยอด ณ วันที่ออก
  taxable_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  exempt_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  rounding_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate             NUMERIC(5,2)  NOT NULL DEFAULT 7.00,

  issued_by            UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, doc_type, doc_no)
);

CREATE INDEX IF NOT EXISTS idx_bms_tax_documents_order
  ON bms_tax_documents (order_id);
CREATE INDEX IF NOT EXISTS idx_bms_tax_documents_issue
  ON bms_tax_documents (tenant_id, doc_type, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_bms_tax_documents_replaces
  ON bms_tax_documents (replaces_document_id) WHERE replaces_document_id IS NOT NULL;

-- ---- 6. เลขผู้เสียภาษีของลูกค้า (สำหรับใบเต็มรูป) --------------------
ALTER TABLE bms_customers
  ADD COLUMN IF NOT EXISTS tax_id      TEXT,
  -- สาขาของ "ผู้ซื้อ" — ใบ Makro ระบุ "สำนักงานใหญ่" ใต้เลขผู้เสียภาษีลูกค้า
  ADD COLUMN IF NOT EXISTS branch_code TEXT;

-- ---- 7. RLS (copy 4.2) ----------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_document_counters','bms_tax_documents']
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

-- ---- 8. GRANT (copy 4.3) --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_document_counters, bms_tax_documents TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 9. permission ---------------------------------------------------
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','tax.document.view'),
  ('Manager','tax.document.issue'),
  ('Manager','tax.setting.manage'),
  ('Sales','tax.document.view'),
  ('Sales','tax.document.issue'),
  ('Pharmacist','tax.document.view'),
  ('Pharmacist','tax.document.issue')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
