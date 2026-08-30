// =============================================================
// BMS — กติกาการปล่อยเชื่อ (9.30) · pure ล้วน
// -------------------------------------------------------------
// ไฟล์นี้ **ตั้งใจไม่ import อะไรเลย** แบบเดียวกับ loyaltyMath.ts และ
// productPolicyDecision.ts — เพื่อให้เทสรันได้โดยไม่ต้องมี Postgres/Next runtime
// ตรรกะที่รันได้เฉพาะตอนมีฐานข้อมูล คือตรรกะที่ไม่ถูกรันในเกือบทุกรอบ
//
// สำคัญกว่านั้น: กติกาวงเงินถูกถามสองครั้งต่อบิล — ด่านแรกก่อนสร้างบิล (ล้มตรงนี้ยัง
// ไม่มีสต็อกถูกจอง) และด่านจริงในทรานแซกชันที่ตัดสต็อกพร้อม FOR UPDATE · สองที่นั้น
// ต้องเรียก **ฟังก์ชันตัวเดียวกัน** ไม่งั้นจอจะบอกว่าขายได้ทั้งที่ server จะปฏิเสธ
// =============================================================

export type ArAccountStatus = "ACTIVE" | "ON_HOLD" | "CLOSED";
export const AR_ACCOUNT_STATUSES: readonly ArAccountStatus[] = ["ACTIVE", "ON_HOLD", "CLOSED"] as const;

export type ArChargeCheck =
  | { ok: true; accountId: string; availableCredit: number }
  | { ok: false; reason: string; code: "NO_ACCOUNT" | "ON_HOLD" | "CLOSED" | "LIMIT_EXCEEDED" };

const round2 = (n: number) => Math.round(n * 100) / 100;

const baht = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function describeArAvailability(account: { creditLimit: number; balance: number }) {
  const balance = round2(account.balance);
  const creditLimit = round2(account.creditLimit);
  const creditBalance = Math.max(0, round2(-balance));
  const creditLineAvailable = Math.max(0, round2(creditLimit - Math.max(0, balance)));
  return {
    creditBalance,
    creditLineAvailable,
    availableCredit: round2(creditLineAvailable + creditBalance),
  };
}

export function evaluateArCharge(
  account: { id: string; status: ArAccountStatus; creditLimit: number; balance: number },
  amount: number
): ArChargeCheck {
  if (account.status === "CLOSED") {
    return { ok: false, code: "CLOSED", reason: "บัญชีเครดิตนี้ถูกปิดแล้ว" };
  }
  if (account.status === "ON_HOLD") {
    return { ok: false, code: "ON_HOLD", reason: "บัญชีเครดิตนี้ถูกระงับการขายเชื่อชั่วคราว" };
  }

  const requested = round2(amount);
  // ⚠️ round2 ตรงนี้ไม่ใช่การจัดหน้าตัวเลข มันคือด่านที่ตัดสินว่าบิลผ่านหรือไม่ผ่าน
  //
  // ยอดสองก้อนที่เป็นสตางค์ลงตัวทั้งคู่ บวกกันในเลขทศนิยมของ JS แล้วเกินค่าที่ควรได้
  // เป็นเศษเสี้ยวได้จริง เช่น 259.30 + 55.29 = 314.59000000000003 · เทียบตรง ๆ กับ
  // วงเงิน 314.59 จะได้ว่า "เกินวงเงิน" ทั้งที่พอดีเป๊ะ — และเกิดแบบสุ่มตามคู่ตัวเลข
  // จนอธิบายกับเจ้าของร้านไม่ได้ · ค่าที่มาจาก NUMERIC(12,2) เป็นสตางค์ลงตัวเสมอ
  // การปัดกลับเป็น 2 ตำแหน่งจึงเป็นการเทียบที่ตรงกับความจริง ไม่ใช่การผ่อนปรน
  const after = round2(account.balance + requested);

  if (after > account.creditLimit) {
    return {
      ok: false,
      code: "LIMIT_EXCEEDED",
      reason:
        `เกินวงเงิน — วงเงิน ฿${baht(account.creditLimit)} ` +
        `ค้างอยู่ ฿${baht(account.balance)} ยอดนี้ ฿${baht(requested)}`,
    };
  }
  return {
    ok: true,
    accountId: account.id,
    // ยอดติดลบ (ร้านค้างลูกค้าจากการคืนของหลังจ่ายครบ) ถูกหักกลบไปแล้วใน `after`
    availableCredit: describeArAvailability({ creditLimit: account.creditLimit, balance: after }).availableCredit,
  };
}
