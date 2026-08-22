-- =============================================================
-- 8.9 — บัตรของขวัญ / เครดิตร้าน (store credit)
-- -------------------------------------------------------------
-- ปิดช่องว่างสองอย่างพร้อมกัน:
--   • ขายบัตรของขวัญไม่ได้เลย
--   • คืนสินค้าได้แค่ "เงินสด" หรือ "คืนเข้าช่องทางเดิม" — ไม่มีทางเลือกคืนเป็น
--     เครดิตร้าน ซึ่งเป็นวิธีที่ร้านชอบที่สุดเพราะเงินไม่ออกจากร้าน
--
-- ใช้รูปแบบ ledger เหมือนแต้มสะสม (7.96) ซึ่งพิสูจน์แล้วในระบบนี้: ยอดคงเหลือ =
-- SUM ของ ledger ไม่ใช่คอลัมน์ที่ถูก UPDATE · คอลัมน์ที่ถูก UPDATE จะเพี้ยนเงียบ ๆ
-- เมื่อมีทางเขียนที่ลืมอัปเดตมัน แล้วไม่มีทางรู้ว่าเพี้ยนตั้งแต่เมื่อไร
--
-- ⚠️ ต่างจากแต้มสะสมข้อเดียวแต่สำคัญ: **ยอดเครดิตติดลบไม่ได้**
-- แต้มยอมให้ติดลบโดยตั้งใจ (กันการคืนของหลังใช้แต้มไปแล้ว) แต่เครดิตร้านคือเงิน
-- ยอดเงินติดลบคือร้านเป็นหนี้ลูกค้าโดยไม่มีใครอนุมัติ · บังคับด้วย CHECK ที่ระดับ
-- ตารางบัตร ไม่ใช่แค่ในโค้ด
--
-- ⚠️ ยอดเครดิตค้างเป็น "หนี้สิน" ในงบดุลเหมือนแต้มค้าง — ก่อนปิดงบต้องส่งตัวเลข
-- ให้บัญชี (ดู bmsStoreCreditOutstanding)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_store_credits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- โค้ดบนบัตร · บัตรของขวัญมีโค้ด · เครดิตที่ผูกกับลูกค้า (จากการคืนของ) ก็มีโค้ด
  -- ด้วยเพื่อให้พนักงานเรียกใช้ได้แม้ลูกค้าจำเบอร์ตัวเองไม่ได้
  code          TEXT NOT NULL,
  -- ผูกกับลูกค้าหรือไม่ · NULL = บัตรของขวัญที่ใครถือก็ใช้ได้ (ตามธรรมชาติของบัตร)
  customer_id   UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  -- ยอดคงเหลือเป็น cache ของ SUM(ledger) · ตัวเลขจริงอยู่ที่ ledger เสมอ
  -- CHECK ที่นี่คือแนวป้องกันสุดท้าย: เขียนให้ติดลบไม่ได้แม้โค้ดจะพลาด
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','VOID','EXPIRED')),
  expires_at    TIMESTAMPTZ,
  issued_by     UUID REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- โค้ดซ้ำในร้านเดียวกันไม่ได้ · ข้ามร้านซ้ำได้ (บัตรของร้านอื่นไม่เกี่ยวกัน)
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS bms_store_credit_ledger (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  credit_id     UUID NOT NULL REFERENCES bms_store_credits(id) ON DELETE CASCADE,
  -- ISSUE  = ออกบัตร/เติมเงิน (บวก)
  -- REDEEM = ใช้จ่ายค่าสินค้า (ลบ)
  -- REFUND = คืนของแล้วคืนเป็นเครดิต (บวก)
  -- REVERSE= ยกเลิกบิลที่จ่ายด้วยเครดิต คืนเครดิตกลับ (บวก)
  -- EXPIRE / ADJUST = หมดอายุ / ปรับด้วยมือ (ต้องมีเหตุผล)
  kind          TEXT NOT NULL CHECK (kind IN ('ISSUE','REDEEM','REFUND','REVERSE','EXPIRE','ADJUST')),
  amount        NUMERIC(12,2) NOT NULL,
  order_id      UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  pos_return_id UUID REFERENCES bms_pos_returns(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- กันจ่ายซ้ำ/คืนซ้ำ — ต้องเป็น partial unique 3 ตัว ไม่ใช่ UNIQUE ก้อนเดียว
--
-- UNIQUE (tenant_id, credit_id, order_id, kind) ก้อนเดียวใช้ไม่ได้ เพราะการคืนสินค้า
-- "บางส่วน" เกิดได้หลายครั้งต่อบิล แต่ละครั้งต้องคืนเครดิตของตัวเอง — ก้อนเดียวจะยอม
-- ให้คืนได้ครั้งแรกเท่านั้นแล้วครั้งที่สองเงียบหายไป (ลูกค้าเสียเงินบนบัตร)
-- (เจอตอนเขียนเทส: การคืนทั้งบิลผ่าน processPosReturn ไม่ได้คืนเครดิตเลย)
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_redeem
  ON bms_store_credit_ledger (tenant_id, credit_id, order_id) WHERE kind = 'REDEEM';
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_cancel_reverse
  ON bms_store_credit_ledger (tenant_id, credit_id, order_id)
  WHERE kind = 'REVERSE' AND pos_return_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_return_reverse
  ON bms_store_credit_ledger (tenant_id, credit_id, pos_return_id)
  WHERE pos_return_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_store_credits_code
  ON bms_store_credits (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_bms_store_credits_customer
  ON bms_store_credits (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_store_credit_ledger_credit
  ON bms_store_credit_ledger (tenant_id, credit_id, created_at);

-- ---- เพิ่ม STORE_CREDIT เป็นวิธีชำระเงิน ------------------------------
-- ต้องเพิ่มทั้งสองที่: ตอนจ่าย (bms_payments) และตอนคืนเงิน
-- (bms_pos_refund_allocations) · ลืมที่สองคือคืนเป็นเครดิตไม่ได้ ซึ่งเป็นครึ่งหนึ่ง
-- ของเหตุผลที่ทำฟีเจอร์นี้
ALTER TABLE bms_payments DROP CONSTRAINT IF EXISTS bms_payments_method_check;
ALTER TABLE bms_payments ADD CONSTRAINT bms_payments_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT'));

ALTER TABLE bms_pos_refund_allocations DROP CONSTRAINT IF EXISTS bms_pos_refund_allocations_method_check;
ALTER TABLE bms_pos_refund_allocations ADD CONSTRAINT bms_pos_refund_allocations_method_check
  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET','STORE_CREDIT'));

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_store_credits', 'bms_store_credit_ledger'] LOOP
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

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_store_credits, bms_store_credit_ledger TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่ + seed -----------------------------------------
-- .redeem ให้คนขายทุกคน (รับบัตรของขวัญเป็นงานประจำ)
-- .issue  ให้ Manager (การออกบัตรคือการสร้างเงินขึ้นมา)
-- .adjust ให้ Manager (ปรับยอดด้วยมือ = แก้ยอดเงินของลูกค้าโดยตรง)
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','storecredit.issue'),
  ('Manager','storecredit.redeem'),
  ('Manager','storecredit.adjust'),
  ('Sales','storecredit.redeem'),
  ('Cashier','storecredit.redeem')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
