-- =============================================================
-- 9.69  เรียกพนักงานจาก QR ประจำโต๊ะ
-- -------------------------------------------------------------
-- คำขอบริการไม่ใช่อาหารและไม่ควรถูกปลอมเป็น submission item: มันไม่แตะราคา สต็อก
-- หรือครัว แต่ต้องผูกกับ QR session + บิล OPEN เดียวกัน และมี lifecycle ที่พนักงาน
-- รับทราบ/ปิดงานได้ชัดเจน
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_restaurant_service_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL,
  table_id        UUID NOT NULL,
  check_id        UUID NOT NULL,
  session_id      UUID NOT NULL,
  request_code    TEXT NOT NULL CHECK (request_code IN (
    'WATER', 'CUTLERY', 'BILL', 'MENU_HELP', 'OTHER'
  )),
  request_note    TEXT CHECK (
    request_note IS NULL OR length(btrim(request_note)) BETWEEN 3 AND 200
  ),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'EXPIRED'
  )),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  completed_by    UUID REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, idempotency_key),
  FOREIGN KEY (tenant_id, location_id, table_id, check_id, session_id)
    REFERENCES bms_restaurant_qr_sessions(tenant_id, location_id, table_id, check_id, id),
  CHECK (
    (status = 'PENDING' AND acknowledged_at IS NULL AND acknowledged_by IS NULL)
    OR (status IN ('ACKNOWLEDGED', 'COMPLETED') AND acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
    OR status = 'EXPIRED'
  ),
  CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (status IN ('PENDING', 'ACKNOWLEDGED') AND completed_at IS NULL)
    OR status = 'EXPIRED'
  ),
  CHECK (status <> 'COMPLETED' OR completed_by IS NOT NULL),
  CHECK ((request_code = 'OTHER') = (request_note IS NOT NULL))
);

-- โต๊ะหนึ่งมีเสียงเรียกที่ยังไม่มีใครรับได้เพียงหนึ่งรายการ ไม่ว่าลูกค้าจะสแกนกี่เครื่อง
-- partial unique index เป็นตัวกัน race หลังทั้งสอง request ผ่าน SELECT พร้อมกัน
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_service_calls_pending_check
  ON bms_restaurant_service_calls (tenant_id, check_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_service_calls_board
  ON bms_restaurant_service_calls (tenant_id, location_id, status, created_at)
  WHERE status IN ('PENDING', 'ACKNOWLEDGED');
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_service_calls_session
  ON bms_restaurant_service_calls (tenant_id, session_id, created_at DESC);

ALTER TABLE bms_restaurant_service_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_restaurant_service_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_restaurant_service_calls_tenant_isolation ON bms_restaurant_service_calls;
CREATE POLICY bms_restaurant_service_calls_tenant_isolation ON bms_restaurant_service_calls
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_restaurant_service_calls TO bms_app;
SELECT public.create_revision_trigger('bms_restaurant_service_calls');

COMMENT ON TABLE bms_restaurant_service_calls IS
  'Non-food service requests raised by guests through a table QR session. Staff acknowledge and '
  'complete these independently from orders, stock reservations and kitchen tickets.';

-- ปิดบิลต้องปิดเสียงเรียกค้างใน transaction เดียวกันกับ session/proposal เดิม
CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- CLOSING ย้อนกลับเป็น OPEN ได้ จึงไม่ใช่จังหวะตัด session/คำขอจากโต๊ะ
  IF NEW.status IN ('PAID', 'CANCELLED', 'MERGED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE bms_restaurant_qr_sessions
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND revoked_at IS NULL;
    UPDATE bms_restaurant_qr_submissions
       SET status = 'EXPIRED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND status = 'PENDING';
    UPDATE bms_restaurant_service_calls
       SET status = 'EXPIRED', completed_at = now(), updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id
       AND status IN ('PENDING', 'ACKNOWLEDGED');
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION bms_expire_restaurant_qr_on_check_close() IS
  'Expires table QR sessions, unreviewed order proposals and active service calls when a dine-in '
  'check reaches PAID, CANCELLED or MERGED. CLOSING remains reversible and does nothing.';
