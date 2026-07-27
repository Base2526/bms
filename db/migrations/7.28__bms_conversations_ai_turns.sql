-- =============================================================
-- 7.28  BMS conversations — AI turn/handoff counter
-- -------------------------------------------------------------
-- P1 (docs/AI Context Strategy for Multi-Tenant Shops.md § Turn Budget Enforcer):
-- นับข้อความติดกันที่ AI ตอบแล้ว "ไม่คืบหน้า" (ไม่มี tool เขียนสำเร็จ เช่น create_order/
-- submit_payment/reorder) ต่อบทสนทนา — reset เป็น 0 ทันทีที่มีความคืบหน้า, ถึง threshold
-- แล้ว force handoff (ดู lib/bms/pipeline.ts)
-- =============================================================

ALTER TABLE bms_conversations
  ADD COLUMN IF NOT EXISTS ai_consecutive_askbacks INTEGER NOT NULL DEFAULT 0
    CHECK (ai_consecutive_askbacks >= 0);
