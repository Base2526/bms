-- =============================================================
-- 7.91  BMS POS returns + refund settlement ledger
-- -------------------------------------------------------------
-- 7.88 ถูกใช้โดย VAT/tax documents อยู่แล้ว จึงย้าย POS return migration
-- มาเลขนี้และคงทุก statement เป็น idempotent สำหรับฐานที่เคยรันไฟล์ POS
-- ชื่อ 7.88 เดิมด้วยมือแล้ว
--
-- สถานะสินค้าและเงินจริงเป็นคนละข้อเท็จจริง:
--   bms_pos_returns                 = ร้านรับสินค้าคืน/คืนสต็อกแล้ว
--   bms_pos_refund_allocations      = เงินแต่ละช่องทางคืนแล้วหรือยัง
-- CASH complete ในจังหวะรับคืนได้ ส่วน CARD/QR/WALLET ต้องมีผู้มีสิทธิ์
-- ยืนยันหลังทำรายการกับผู้ให้บริการจริง
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_returns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  pos_device_id   UUID REFERENCES bms_pos_devices(id) ON DELETE SET NULL,
  returned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  return_mode     TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (return_mode IN ('FULL','PARTIAL')),
  refund_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  settlement_status TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (settlement_status IN ('PENDING','COMPLETED')),
  idempotency_key TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_mode TEXT NOT NULL DEFAULT 'PARTIAL',
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_pos_returns_mode_check') THEN
    ALTER TABLE bms_pos_returns ADD CONSTRAINT bms_pos_returns_mode_check
      CHECK (return_mode IN ('FULL','PARTIAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_pos_returns_settlement_check') THEN
    ALTER TABLE bms_pos_returns ADD CONSTRAINT bms_pos_returns_settlement_check
      CHECK (settlement_status IN ('PENDING','COMPLETED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_pos_returns_order
  ON bms_pos_returns (tenant_id, order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_returns_idempotency
  ON bms_pos_returns (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_pos_return_items (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  pos_return_id     UUID NOT NULL REFERENCES bms_pos_returns(id) ON DELETE CASCADE,
  order_item_id     BIGINT NOT NULL REFERENCES bms_order_items(id) ON DELETE CASCADE,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  pack_qty          INTEGER CHECK (pack_qty IS NULL OR pack_qty > 0),
  refund_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ฐาน local บางชุดเคยใช้ migration POS-return รุ่นก่อนที่จะย้ายมาเลข 7.91
-- CREATE TABLE IF NOT EXISTS ไม่เติมคอลัมน์ให้ตารางเดิม จึงต้อง extend แยกไว้ด้วย
ALTER TABLE bms_pos_return_items
  ADD COLUMN IF NOT EXISTS pack_qty INTEGER,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bms_pos_return_items_order_item
  ON bms_pos_return_items (order_item_id);

-- ระบุว่าแต่ละการคืนได้นำจำนวนกลับเข้า lot เดิมเท่าไร ป้องกัน partial return
-- หลายครั้งบวกกลับเข้า lot แรกซ้ำและทำ provenance/recall เพี้ยน
CREATE TABLE IF NOT EXISTS bms_pos_return_item_lots (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  pos_return_item_id BIGINT NOT NULL REFERENCES bms_pos_return_items(id) ON DELETE CASCADE,
  lot_id             UUID NOT NULL REFERENCES bms_inventory_lots(id) ON DELETE RESTRICT,
  qty                INTEGER NOT NULL CHECK (qty > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pos_return_item_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_return_item_lots_lot
  ON bms_pos_return_item_lots (tenant_id, lot_id);

CREATE TABLE IF NOT EXISTS bms_pos_refund_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  pos_return_id   UUID NOT NULL REFERENCES bms_pos_returns(id) ON DELETE CASCADE,
  payment_id      UUID NOT NULL REFERENCES bms_payments(id) ON DELETE RESTRICT,
  method          TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH','WALLET')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED')),
  external_ref    TEXT,
  completed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pos_return_id, payment_id),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_refund_allocations_pending
  ON bms_pos_refund_allocations (tenant_id, created_at)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bms_pos_refund_allocations_payment
  ON bms_pos_refund_allocations (tenant_id, payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_refund_allocation_return_payment
  ON bms_pos_refund_allocations (pos_return_id, payment_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_pos_returns',
    'bms_pos_return_items',
    'bms_pos_return_item_lots',
    'bms_pos_refund_allocations'
  ] LOOP
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

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_pos_returns,
  bms_pos_return_items,
  bms_pos_return_item_lots,
  bms_pos_refund_allocations
TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
