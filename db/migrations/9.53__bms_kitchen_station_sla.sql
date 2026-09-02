-- 9.53 เกณฑ์เวลาของจอครัว แยกตามสถานี
--
-- จอครัว (9.52 UI) เปลี่ยนสีตัวนับที่ 5 และ 10 นาทีด้วยค่าคงที่ชุดเดียวทั้งร้าน ซึ่งผิดกับ
-- ของจริง: บาร์ชงชาเย็นเสร็จใน 2 นาที ส่วนครัวร้อนผัดกับข้าวใช้ 8-12 นาทีเป็นปกติ
-- เกณฑ์เดียวจึงทำให้ครัวร้อนแดงตลอดเวลา (สีเลิกมีความหมาย) หรือบาร์ไม่เคยเตือนเลย
--
-- สถานีในระบบนี้เป็น "ข้อความอิสระ" บน bms_product_stock_policies.kitchen_station ไม่มี
-- ตารางของตัวเอง ตารางนี้จึงเก็บเป็นค่าตั้งต่อชื่อสถานี และแถวของสถานีที่เลิกใช้แล้วก็แค่
-- ไม่มีใครอ่าน (ไม่ต้องตามลบ) · ร้านที่ไม่ตั้งอะไรเลยได้ค่าปริยาย 5/10 จากโค้ดเหมือนเดิม
--
-- ไม่มี permission ใหม่ — ใช้ product.edit ตัวเดียวกับสวิตช์ความสามารถและรูปแบบสต็อก
-- ซึ่งเป็นสิทธิ์ที่ดูแลหน้า /admin/stock-models อยู่แล้ว

BEGIN;

CREATE TABLE IF NOT EXISTS bms_kitchen_station_slas (
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  station       TEXT NOT NULL,
  warn_minutes  INTEGER NOT NULL,
  late_minutes  INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, station),
  -- เหลืองต้องมาก่อนแดงเสมอ ไม่งั้นใบกระโดดจากปกติเป็นแดงโดยไม่มีขั้นเตือน
  CONSTRAINT bms_kitchen_station_slas_order_check CHECK (warn_minutes < late_minutes),
  -- เพดานกันค่าที่พิมพ์พลาด (0 = เตือนตั้งแต่วินาทีแรก, 600 = 10 ชั่วโมง)
  CONSTRAINT bms_kitchen_station_slas_range_check
    CHECK (warn_minutes >= 0 AND late_minutes > 0 AND late_minutes <= 600),
  CONSTRAINT bms_kitchen_station_slas_station_check CHECK (btrim(station) <> '')
);

ALTER TABLE bms_kitchen_station_slas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_kitchen_station_slas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_kitchen_station_slas_tenant_isolation ON bms_kitchen_station_slas;
CREATE POLICY bms_kitchen_station_slas_tenant_isolation ON bms_kitchen_station_slas
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_kitchen_station_slas TO bms_app;

SELECT public.create_revision_trigger('bms_kitchen_station_slas');

COMMENT ON TABLE bms_kitchen_station_slas IS
  'Per-station kitchen SLA thresholds (9.53). Rows are keyed by the free-text station name on bms_product_stock_policies.kitchen_station; a station with no row falls back to the code defaults (5/10 minutes).';

COMMIT;
