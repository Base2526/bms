-- =============================================================
-- 9.32 — ผูกการรับคืนและการยืนยันคืนเงินจริงกับกะที่เกิดเหตุการณ์
-- -------------------------------------------------------------
-- order.pos_shift_id คือกะที่ "ขาย" บิลเดิม ไม่ใช่กะที่ลูกค้านำของมาคืน
-- การใช้กะขายเดิมใน X/Z report ทำให้การคืนวันนี้ย้อนกลับไปเปลี่ยนรายงานกะเก่า
-- และทำให้เงินสดที่จ่ายออกวันนี้ไม่ปรากฏในกะที่ถือเงินจริง
--
-- แถวใหม่เขียน shift_id โดยตรงจากกะเปิดของเครื่อง POS ส่วนข้อมูลเก่าพยายาม
-- จับกะจาก device + เวลาของเหตุการณ์ก่อน และใช้กะขายเดิมเป็น fallback เท่านั้น
-- เมื่อไม่มีหลักฐานเวลาที่ดีกว่า คอลัมน์จึงยัง nullable เพื่อไม่แต่งข้อเท็จจริง
-- =============================================================

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL;

ALTER TABLE bms_pos_refund_allocations
  ADD COLUMN IF NOT EXISTS completed_shift_id UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL;

UPDATE bms_pos_returns pr
   SET shift_id = (
    SELECT s.id
      FROM bms_pos_shifts s
     WHERE s.tenant_id = pr.tenant_id
       AND s.device_id = pr.pos_device_id
       AND s.opened_at <= pr.created_at
       AND (s.closed_at IS NULL OR s.closed_at >= pr.created_at)
     ORDER BY s.opened_at DESC
     LIMIT 1
   )
 WHERE pr.shift_id IS NULL
   AND EXISTS (
     SELECT 1 FROM bms_pos_shifts s
      WHERE s.tenant_id = pr.tenant_id
        AND s.device_id = pr.pos_device_id
        AND s.opened_at <= pr.created_at
        AND (s.closed_at IS NULL OR s.closed_at >= pr.created_at)
   );

UPDATE bms_pos_refund_allocations a
   SET completed_shift_id = (
     SELECT s.id
       FROM bms_pos_returns pr
       JOIN bms_pos_shifts s
         ON s.tenant_id = pr.tenant_id
        AND s.device_id = pr.pos_device_id
        AND s.opened_at <= a.completed_at
        AND (s.closed_at IS NULL OR s.closed_at >= a.completed_at)
      WHERE pr.tenant_id = a.tenant_id AND pr.id = a.pos_return_id
      ORDER BY s.opened_at DESC
      LIMIT 1
   )
 WHERE a.status = 'COMPLETED'
   AND a.completed_shift_id IS NULL
   AND a.completed_at IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM bms_pos_returns pr
       JOIN bms_pos_shifts s
         ON s.tenant_id = pr.tenant_id
        AND s.device_id = pr.pos_device_id
        AND s.opened_at <= a.completed_at
        AND (s.closed_at IS NULL OR s.closed_at >= a.completed_at)
      WHERE pr.tenant_id = a.tenant_id AND pr.id = a.pos_return_id
   );

CREATE INDEX IF NOT EXISTS idx_bms_pos_returns_shift
  ON bms_pos_returns (tenant_id, shift_id, created_at) WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_pos_refund_allocations_completed_shift
  ON bms_pos_refund_allocations (tenant_id, completed_shift_id, completed_at)
  WHERE completed_shift_id IS NOT NULL;

COMMENT ON COLUMN bms_pos_returns.shift_id IS
  'กะของเครื่องที่รับสินค้าคืนจริง; ไม่ใช่กะขายเดิมบน order (9.32)';

COMMENT ON COLUMN bms_pos_refund_allocations.completed_shift_id IS
  'กะที่ยืนยันว่าคืนเงินจริงของ allocation นี้แล้ว; CASH/CREDIT ใช้กะรับคืน (9.32)';
