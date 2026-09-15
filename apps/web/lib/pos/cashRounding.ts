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

/**
 * ปัดเศษได้เฉพาะบิลที่ **ทุกช่องทางเป็นเงินสด** — กฎเดียวกับ `recordPosSale()`
 * (`requestedPayments.every(p => p.method === "CASH")` หลังกรองยอดที่เป็น 0 ทิ้ง)
 *
 * ⚠️ ทุกจอที่รับเงินต้องเรียกตัวนี้ ห้ามเขียนเงื่อนไขเอง — จอร้านอาหารเคยเขียนว่า
 * `payments.length === 1 && method === "CASH"` ซึ่งแปลว่าบิลที่แบ่งจ่ายเงินสดสองช่องทาง
 * ไม่ถูกปัดที่จอ แต่ถูกปัดที่ server → ยอดต่างกันแล้วบิลถูกทิ้งทั้งใบ (PAYMENT_MISMATCH)
 *
 * ก่อนกรอกจำนวนเงิน ใช้ "วิธีจ่ายที่เลือกไว้" ตัดสินแทน ไม่งั้นยอดที่ต้องเก็บจะกระพริบ
 * ตอนแคชเชียร์เริ่มพิมพ์ตัวเลขตัวแรก
 */
export function cashRoundingForPayments(
  payableBeforeRounding: number,
  mode: CashRounding,
  payments: ReadonlyArray<{ method: string; amount: number | string }>
): number {
  if (mode === "NONE" || payableBeforeRounding <= 0) return 0;
  const withAmount = payments.filter((payment) => (Number(payment.amount) || 0) > 0);
  const considered = withAmount.length > 0 ? withAmount : payments;
  if (considered.length === 0) return 0;
  if (!considered.every((payment) => String(payment.method).toUpperCase() === "CASH")) return 0;
  return cashRoundingDelta(payableBeforeRounding, mode);
}
