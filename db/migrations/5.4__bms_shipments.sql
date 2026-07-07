-- =============================================================
-- 5.4  BMS Shipping — shipments + carrier + tracking + label
-- -------------------------------------------------------------
-- ตาม CLAUDE.md §10 + TOOLS.md: createShipment / updateTracking + label
--
-- carriers: FLASH / KERRY / DHL / AUSPOST / NZPOST / OTHER
-- flow ต่อ 1 shipment:
--   PENDING → SHIPPED → IN_TRANSIT → DELIVERED  (└→ RETURNED / CANCELLED)
--
-- createShipment: ถ้า order = PACKING จะ ship จริง (order → SHIPPED + ตัดสต็อก
--   + SHIP movement) ในทรานแซกชันเดียว แล้วผูก tracking/carrier
--   ถ้า order = SHIPPED อยู่แล้ว (ship มาก่อน) แค่แนบ shipment ไม่ตัดสต็อกซ้ำ
-- setShipmentStatus = DELIVERED → order SHIPPED → COMPLETED (best-effort)
-- multi-tenant + RLS เหมือนตาราง BMS อื่น (idempotent)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_shipments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  carrier      TEXT NOT NULL
                 CHECK (carrier IN ('FLASH','KERRY','DHL','AUSPOST','NZPOST','OTHER')),
  tracking_no  TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','SHIPPED','IN_TRANSIT','DELIVERED','RETURNED','CANCELLED')),
  label_url    TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_shipments_order    ON bms_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_bms_shipments_tenant   ON bms_shipments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bms_shipments_tracking ON bms_shipments(tracking_no) WHERE tracking_no IS NOT NULL;

-- ---- Row-Level Security (เหมือน 4.2) ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE bms_shipments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE bms_shipments FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS bms_shipments_tenant_isolation ON bms_shipments';
  EXECUTE $p$
    CREATE POLICY bms_shipments_tenant_isolation ON bms_shipments
      USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
      WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  $p$;
END $$;

-- ---- grant ให้ RLS role (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_shipments TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
