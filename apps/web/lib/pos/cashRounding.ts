// =============================================================
// ปัดเศษเงินสด — กติกาเดียวที่ทั้งจอขายและ server ต้องใช้ร่วมกัน
// -------------------------------------------------------------
// อยู่แยกจาก taxDocuments.ts เพราะจอขายเป็น client component: import
// ไฟล์ที่ลาก `pg` เข้ามาไม่ได้ · ถ้าสองฝั่งคิดคนละแบบเมื่อไหร่ ยอดที่จอส่งไป
// จะไม่ตรงกับที่ server คิด แล้วบิลจะโดน PAYMENT_MISMATCH ทิ้งทั้งใบ
// =============================================================

export type CashRounding = "NONE" | "0.25" | "0.50" | "1.00";

export const CASH_ROUNDING_OPTIONS: CashRounding[] = ["NONE", "0.25", "0.50", "1.00"];

export function isCashRounding(v: unknown): v is CashRounding {
  return typeof v === "string" && (CASH_ROUNDING_OPTIONS as string[]).includes(v);
}

/**
 * คืน "ส่วนต่าง" ที่ต้องบันทึกเป็นยอดปัดเศษ
 * ปัดขึ้น/ลงเข้าหาค่าที่ใกล้ที่สุด เศษครึ่งพอดีปัดขึ้น (เข้าทางร้าน แบบที่ใช้กันจริง)
 * ยอดปัดไม่ใช่ส่วนลด จึงไม่แตะฐาน VAT — เป็นบรรทัดของตัวเองบนใบเสร็จ
 */
export function cashRoundingDelta(amount: number, mode: CashRounding): number {
  if (mode === "NONE") return 0;
  const step = Number(mode);
  if (!Number.isFinite(step) || step <= 0) return 0;
  const rounded = Math.round((amount / step) + Number.EPSILON) * step;
  return Math.round((rounded - amount) * 100) / 100;
}
