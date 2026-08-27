-- =============================================================
-- 9.30 — ขายเชื่อ + ลูกหนี้การค้า (accounts receivable)
-- -------------------------------------------------------------
-- ช่องว่างที่ปิด: ระบบรับเงินได้ 7 วิธี แต่ไม่มีวิธีไหนแปลว่า "ยังไม่ได้เงิน"
-- ร้านที่มีลูกค้าประจำเปิดบิลเชื่อแล้วเก็บเงินสิ้นเดือน (ร้านค้าส่ง ร้านวัสดุ ร้านที่
-- ขายให้ร้านอาหารแถวนั้น) จึงใช้ POS ตัวนี้ไม่ได้เลย — ไม่ใช่ไม่สะดวก แต่ทำไม่ได้
--
-- ⚠️ ต่างจากมัดจำ (9.0) กลับด้านกันคนละเรื่อง อย่าเอามาแทนกัน:
--   มัดจำ   = ได้เงินบางส่วน **ของยังอยู่กับร้าน** บิลค้างที่ PENDING
--   ขายเชื่อ = **ของออกจากร้านแล้ว** บิลปิดครบเส้น (ตัดสต็อก ออกใบกำกับ ให้แต้ม)
--             แต่เงินยังไม่เข้า → เกิด "ลูกหนี้" ซึ่งเป็นสินทรัพย์ ไม่ใช่บิลค้าง
--
-- ทำไมขายเชื่อเป็น "วิธีชำระเงิน" (bms_payments.method = 'CREDIT') ไม่ใช่บิลที่ยังไม่จ่าย:
--   กฎ "ยอดชำระต้องเท่ายอดบิลพอดี" ของ POS คือสิ่งที่กันการเก็บเงินไม่ตรงกับที่ระบบคิด
--   และ **ต้องไม่ถูกคลาย** · การให้ยอดค้างเป็นแถวชำระเงินชนิดหนึ่งทำให้เส้นทางปิดการขาย
--   เดิมทั้งเส้นใช้ได้โดยไม่ต้องแตะ — รวมถึงเส้นทางคืนของ ซึ่งจัดสรรยอดคืนกลับไปที่
--   "แถวชำระเงินที่จ่ายมา" อยู่แล้ว → คืนของบิลเชื่อจึงไปลดหนี้เองโดยอัตโนมัติ
--   ถ้าทำเป็นบิลค้างแทน จะต้องเขียนเส้นทางคืน/void/ใบกำกับใหม่ทั้งชุด
--
-- ⚠️ 'CREDIT' ไม่ใช่เงินสด — ต้องไม่เข้าสูตรเงินในลิ้นชัก · drawerExpectedInTx()
--   กรอง method = 'CASH' อยู่แล้วจึงปลอดภัยโดยโครงสร้าง (กฎเดียวกับ STORE_CREDIT ที่ 8.9)
--   เงินที่เก็บได้ทีหลังเข้าลิ้นชักผ่าน bms_pos_cash_movements (direction IN) แทน
--   เพราะบิลต้นทางอยู่คนละกะ — ลง bms_payments ของบิลเดิมจะทำให้เงินไปโผล่ในกะที่ปิดไปแล้ว
--
-- ⚠️ ยอดลูกหนี้คงค้างเป็น **สินทรัพย์** ในงบดุล (กลับข้างกับแต้ม/เครดิตร้านที่เป็นหนี้สิน)
--   ส่งตัวเลขจาก getArOutstanding() ให้บัญชีก่อนปิดงบ · balanceMismatchCount ต้องเป็น 0
-- =============================================================

-- ---- 1. บัญชีลูกหนี้ต่อลูกค้า ------------------------------------------
-- หนึ่งลูกค้า = หนึ่งบัญชี · customer_id เป็น NOT NULL โดยตั้งใจ: หนี้ที่ไม่รู้ว่าใคร
-- เป็นหนี้ไม่ใช่ลูกหนี้ มันคือของหาย · walk-in ขายเชื่อไม่ได้ ต้องผูกลูกค้าก่อน
CREATE TABLE IF NOT EXISTS bms_ar_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  -- เพดานหนี้ · 0 = เปิดบัญชีไว้แต่ยังไม่ให้เครดิต (ต้องตั้งวงเงินก่อนขายเชื่อได้)
  credit_limit  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  -- เครดิตเทอม (วัน) · ใช้คำนวณ due_at ของใบแจ้งหนี้ตอนขาย ไม่ใช่ตอนอ่านรายงาน
  -- เก็บวันครบกำหนดไว้กับใบ เพราะแก้เทอมวันนี้ต้องไม่ย้ายวันครบกำหนดของหนี้เก่า
  terms_days    INT NOT NULL DEFAULT 30 CHECK (terms_days >= 0 AND terms_days <= 365),
  -- ACTIVE  = ขายเชื่อได้
  -- ON_HOLD = ขายเชื่อไม่ได้แต่ยังรับชำระได้ (ค้างนาน/ผิดนัด)
  -- CLOSED  = ปิดบัญชี · ปิดได้เมื่อยอดเป็น 0 เท่านั้น (บังคับในโค้ด)
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','ON_HOLD','CLOSED')),
  -- cache ของ SUM(ledger.amount) · ตัวเลขจริงอยู่ที่ ledger เสมอ (รูปแบบเดียวกับ 7.96/8.9)
  --
  -- ⚠️ ไม่มี CHECK (balance >= 0) ต่างจากเครดิตร้าน (8.9) โดยตั้งใจ:
  -- ลูกค้าจ่ายครบแล้วเอาของมาคืน = ร้านค้างลูกค้าอยู่ ยอดติดลบคือความจริงทางบัญชี
  -- ถ้าใส่ CHECK ไว้ การคืนของที่ถูกต้องจะล้มกลางเคาน์เตอร์ ซึ่งแย่กว่ายอดติดลบ
  -- ยอดติดลบจะถูกหักกลบเองในบิลเชื่อใบถัดไป (balance = SUM(ledger) อยู่แล้ว)
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id)
);

-- ---- 2. ใบแจ้งหนี้ = ยอดค้างของบิลหนึ่งใบ -------------------------------
-- ต้องมีระดับ "ใบ" ไม่ใช่ยอดรวมของบัญชีอย่างเดียว เพราะการวิเคราะห์อายุหนี้ (aging)
-- ตอบไม่ได้ว่าเงินก้อนไหนค้างมากี่วันถ้าเก็บแต่ยอดรวม — และการติดตามหนี้ทั้งหมด
-- เริ่มจากคำถามนั้น
CREATE TABLE IF NOT EXISTS bms_ar_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES bms_ar_accounts(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES bms_locations(id),
  -- กะที่เกิดการขายเชื่อ · ใช้ตอบ "กะนี้ปล่อยเชื่อไปเท่าไร" ในรายงานปิดกะ
  shift_id        UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL,
  -- ยอดที่ค้างตอนขาย (= ยอดของแถว payment ชนิด CREDIT ไม่ใช่ยอดบิลทั้งใบ
  -- เพราะจ่ายสดบางส่วนแล้วค้างบางส่วนได้)
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  -- ยอดที่ถูกลดด้วยการคืนของ/ยกเลิกบิล/ตัดหนี้สูญ
  credited_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  -- ยอดที่ชำระแล้ว · รวมยอดเครดิตติดลบจากใบเก่าที่นำมาหักกลบ (กรณีนั้นไม่มี receipt)
  settled_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','PARTIAL','PAID','VOID','WRITTEN_OFF')),
  created_by      UUID REFERENCES users(id),
  closed_at       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- บิลหนึ่งใบมีหนี้ได้ใบเดียว
  UNIQUE (tenant_id, order_id)
);

-- ---- 3. การรับชำระหนี้ (เหตุการณ์รับเงินหนึ่งครั้ง) ------------------------
-- แยกจาก ledger เพราะเงินก้อนเดียวตัดได้หลายใบ (จ่าย ฿5,000 ปิดใบเก่า 3 ใบ)
-- ถ้าไม่มีตารางนี้ ใบเสร็จรับชำระจะอ้างอิงอะไรไม่ได้เลย
CREATE TABLE IF NOT EXISTS bms_ar_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES bms_ar_accounts(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES bms_locations(id),
  device_id       UUID REFERENCES bms_pos_devices(id) ON DELETE SET NULL,
  -- กะที่รับเงิน · เงินสดที่รับต้องเข้าลิ้นชักของกะนี้ ไม่ใช่กะที่ขายของ
  shift_id        UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL,
  method          TEXT NOT NULL
                    CHECK (method IN ('CASH','BANK_TRANSFER','QR','CARD','WALLET')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reference       TEXT,
  note            TEXT,
  received_by     UUID NOT NULL REFERENCES users(id),
  -- กดปุ่มซ้ำเพราะเน็ตช้าต้องไม่รับเงินสองรอบ (บทเรียนเดียวกับ 9.5)
  idempotency_key TEXT NOT NULL,
  -- hash ของคำขอที่ normalize แล้ว · คีย์เดิมใช้กับยอด/บัญชี/วิธีอื่นต้องเป็น conflict
  -- ไม่ใช่ replay ใบรับเงินเก่าให้คำขอคนละก้อน (และไม่เก็บ note/reference ดิบซ้ำ)
  request_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- ---- 4. ledger — แหล่งความจริงของยอดหนี้ --------------------------------
-- amount เป็นเลขมีเครื่องหมาย: + = เป็นหนี้เพิ่ม, − = หนี้ลด
--   CHARGE      ขายเชื่อ (+)
--   PAYMENT     เก็บเงินได้ หรือใช้ยอดเครดิตคงเหลือหักกลบ (−)
--   CREDIT_NOTE คืนของ / ยกเลิกบิล (−)
--   WRITE_OFF   ตัดหนี้สูญ (−)
--   ADJUST      ปรับด้วยมือ (±) ต้องมีเหตุผล
CREATE TABLE IF NOT EXISTS bms_ar_ledger (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES bms_ar_accounts(id) ON DELETE CASCADE,
  -- ทุกแถวผูกกับใบ เพราะยอดค้างต้องบอกอายุได้เสมอ (ดูเหตุผลที่ตาราง invoices)
  invoice_id    UUID NOT NULL REFERENCES bms_ar_invoices(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                  CHECK (kind IN ('CHARGE','PAYMENT','CREDIT_NOTE','WRITE_OFF','ADJUST')),
  amount        NUMERIC(12,2) NOT NULL,
  receipt_id    UUID REFERENCES bms_ar_receipts(id) ON DELETE CASCADE,
  order_id      UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  pos_return_id UUID REFERENCES bms_pos_returns(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- เครื่องหมายต้องตรงกับชนิดเสมอ · แถวที่เครื่องหมายกลับข้างจะทำให้ยอดหนี้เพี้ยน
  -- แบบที่หาต้นเหตุไม่เจอ เพราะ SUM ยังดูสมเหตุสมผลอยู่
  CONSTRAINT bms_ar_ledger_sign_check CHECK (
    (kind = 'CHARGE' AND amount > 0)
    OR (kind IN ('PAYMENT','CREDIT_NOTE','WRITE_OFF') AND amount < 0)
    OR (kind = 'ADJUST' AND amount <> 0)
  )
);

-- กันคิดซ้ำ — ต้องเป็น partial unique หลายตัว ไม่ใช่ก้อนเดียว (บทเรียนจาก 8.9)
-- ใบหนึ่งใบตั้งหนี้ได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ar_ledger_charge
  ON bms_ar_ledger (tenant_id, invoice_id) WHERE kind = 'CHARGE';
-- เงินหนึ่งก้อนตัดใบหนึ่งใบได้ครั้งเดียว (แต่ตัดได้หลายใบต่อก้อน)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ar_ledger_payment
  ON bms_ar_ledger (tenant_id, receipt_id, invoice_id) WHERE kind = 'PAYMENT';
-- การคืนหนึ่งครั้งลดหนี้ของใบหนึ่งใบได้ครั้งเดียว · คีย์ด้วย pos_return_id ไม่ใช่
-- order_id เพราะคืนบางส่วนเกิดได้หลายครั้งต่อบิล (บทเรียนตรง ๆ จาก 8.9)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ar_ledger_return
  ON bms_ar_ledger (tenant_id, invoice_id, pos_return_id)
  WHERE kind = 'CREDIT_NOTE' AND pos_return_id IS NOT NULL;
-- ใบหนึ่งใบตัดหนี้สูญได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ar_ledger_writeoff
  ON bms_ar_ledger (tenant_id, invoice_id) WHERE kind = 'WRITE_OFF';

CREATE INDEX IF NOT EXISTS idx_bms_ar_accounts_customer
  ON bms_ar_accounts (tenant_id, customer_id);
-- คิวติดตามหนี้: ใบที่ยังค้าง เรียงตามวันครบกำหนด
CREATE INDEX IF NOT EXISTS idx_bms_ar_invoices_open
  ON bms_ar_invoices (tenant_id, due_at)
  WHERE status IN ('OPEN', 'PARTIAL');
CREATE INDEX IF NOT EXISTS idx_bms_ar_invoices_account
  ON bms_ar_invoices (tenant_id, account_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_ar_ledger_invoice
  ON bms_ar_ledger (tenant_id, invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bms_ar_ledger_account
  ON bms_ar_ledger (tenant_id, account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bms_ar_receipts_shift
  ON bms_ar_receipts (tenant_id, shift_id, created_at) WHERE shift_id IS NOT NULL;

COMMENT ON TABLE bms_ar_accounts IS
  'บัญชีลูกหนี้การค้าต่อลูกค้า — วงเงิน/เครดิตเทอม/ยอดค้าง (9.30)';
COMMENT ON TABLE bms_ar_invoices IS
  'ยอดค้างของบิลขายเชื่อหนึ่งใบ — หน่วยที่ใช้วิเคราะห์อายุหนี้ (9.30)';
COMMENT ON COLUMN bms_ar_accounts.balance IS
  'cache ของ SUM(bms_ar_ledger.amount) · ติดลบได้ = ร้านค้างลูกค้าจากการคืนของหลังจ่ายครบ';

-- ---- 5. เพิ่ม CREDIT เป็นวิธีชำระเงิน ----------------------------------
-- ต้องเพิ่มทั้งสองที่เหมือนตอน 8.9: ตอนขาย (bms_payments) และตอนคืน
-- (bms_pos_refund_allocations) · ลืมที่สอง = คืนของบิลเชื่อไม่ได้ ซึ่งจะทำให้ของ
-- กลับเข้าสต็อกไม่ได้และหนี้ค้างอยู่ทั้งก้อนทั้งที่ลูกค้าเอาของมาคืนแล้ว
ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT'));

ALTER TABLE bms_pos_refund_allocations DROP CONSTRAINT IF EXISTS bms_pos_refund_allocations_method_check;
ALTER TABLE bms_pos_refund_allocations ADD CONSTRAINT bms_pos_refund_allocations_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT','CREDIT'));

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_ar_accounts','bms_ar_invoices','bms_ar_receipts','bms_ar_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON bms_ar_accounts, bms_ar_invoices, bms_ar_receipts, bms_ar_ledger TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่ + seed -----------------------------------------
-- ar.view    ดูว่าใครค้างเท่าไร — คนหน้าร้านต้องเห็นก่อนตัดสินใจปล่อยเชื่อ
-- ar.sell    ขายเชื่อ = ปล่อยของออกจากร้านโดยยังไม่ได้เงิน · ไม่ให้ Cashier โดยปริยาย
--            แต่แคชเชียร์ยังขายเชื่อได้ด้วย PIN ของคนที่มีสิทธิ์ (แบบเดียวกับ 9.29)
-- ar.collect รับชำระหนี้ = รับเงิน เป็นงานประจำของทุกคนที่ยืนเคาน์เตอร์
-- ar.manage  ตั้งวงเงิน/เทอม/ระงับบัญชี = กำหนดว่าร้านจะเสี่ยงกับใครเท่าไร
-- ar.writeoff ตัดหนี้สูญ = ลบสินทรัพย์ของร้านทิ้ง · แยกจาก .manage โดยตั้งใจ
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','ar.view'),
  ('Manager','ar.sell'),
  ('Manager','ar.collect'),
  ('Manager','ar.manage'),
  ('Manager','ar.writeoff'),
  ('Sales','ar.view'),
  ('Sales','ar.sell'),
  ('Sales','ar.collect'),
  ('Cashier','ar.view'),
  ('Cashier','ar.collect')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
