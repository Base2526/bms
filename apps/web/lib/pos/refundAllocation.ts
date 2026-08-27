import type { PaymentMethod } from "@/lib/bms/payments";

/**
 * ลำดับ fallback เมื่อ client รุ่นเก่าไม่ได้ระบุช่องทางคืนที่ต้องการก่อน
 *
 * หนี้/เครดิตร้านต้องกลับเข้าบัญชีเดิมก่อน จากนั้นใช้ช่องทางที่ตรวจสอบย้อนหลังได้
 * และเก็บเงินสดไว้ท้ายสุดเพื่อลดการจ่ายเงินออกจากลิ้นชักโดยไม่จำเป็น ผู้ใช้ POS รุ่น
 * ปัจจุบันจะต้องเลือกช่องทางแรกเองเมื่อบิลมีหลายวิธี; ลำดับนี้จึงใช้กับยอดที่ล้นจาก
 * ช่องทางที่เลือก, void และ client รุ่นเก่าเป็นหลัก
 */
export const DEFAULT_REFUND_METHOD_ORDER: readonly PaymentMethod[] = [
  "CREDIT",
  "STORE_CREDIT",
  "CARD",
  "QR",
  "BANK_TRANSFER",
  "WALLET",
  "TIKTOK",
  "CASH",
];

const DEFAULT_RANK = new Map(DEFAULT_REFUND_METHOD_ORDER.map((method, index) => [method, index]));

/**
 * คืนสำเนาที่เรียงแบบแน่นอน: ช่องทางที่พนักงานเลือกก่อน แล้วตาม fallback ข้างบน
 * ภายในวิธีเดียวกันเรียง UUID เพื่อให้ลำดับ lock เหมือนกันทุก instance
 */
export function orderRefundPaymentsForAllocation<
  T extends { id: string; method: PaymentMethod },
>(payments: readonly T[], preferredMethod?: PaymentMethod | null): T[] {
  return [...payments].sort((left, right) => {
    const leftPreferred = preferredMethod && left.method === preferredMethod ? 0 : 1;
    const rightPreferred = preferredMethod && right.method === preferredMethod ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;

    const methodDelta = (DEFAULT_RANK.get(left.method) ?? Number.MAX_SAFE_INTEGER)
      - (DEFAULT_RANK.get(right.method) ?? Number.MAX_SAFE_INTEGER);
    if (methodDelta !== 0) return methodDelta;
    return left.id.localeCompare(right.id);
  });
}
