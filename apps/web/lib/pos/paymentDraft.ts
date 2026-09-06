export type PosPaymentDraft = {
  id: string;
  method: string;
  amount: string;
  tendered: string;
  ref: string;
};

/**
 * Add a payment row, entering split-payment mode when the bill currently has one row.
 *
 * A cash-only draft stores the whole bill in both `amount` and `tendered`. Keeping that
 * tender after the cashier changes `amount` to the cash share would manufacture change
 * from stale state (for example 48,300 tendered - 15,000 cash = 33,300 change).
 * Clear it only on the single-row -> split transition so the cashier either accepts the
 * cash share as exact or enters the amount physically tendered again. Existing split rows
 * keep their tender values when a third or later method is added.
 */
export function appendSplitPaymentRow(
  current: readonly PosPaymentDraft[],
  amountDue: number,
  nextId: string,
): PosPaymentDraft[] {
  const enteringSplitMode = current.length === 1;
  const existing = enteringSplitMode
    ? current.map((payment) => ({
        ...payment,
        amount: payment.amount || String(amountDue),
        tendered: payment.method === "CASH" ? "" : payment.tendered,
      }))
    : [...current];

  return [
    ...existing,
    { id: nextId, method: "QR", amount: "", tendered: "", ref: "" },
  ];
}

/**
 * เหตุผลที่ยังกด "ยืนยันรับเงิน" ไม่ได้ — `null` = กดได้
 *
 * จอต้องกันสิ่งที่ตัวเองรู้อยู่แล้วว่าจะถูกปฏิเสธ ไม่ใช่ปล่อยให้กดแล้วค่อยล้มที่ server
 * (กฎเดียวกับที่จอกันตัวเลือกที่บังคับของเมนูไว้ก่อนส่ง) · สองด่านนี้ server ตรวจอยู่แล้ว:
 *   - ยอดรวมต้องเท่ากับยอดที่ต้องชำระเป๊ะ (POS ไม่คลายกฎนี้ให้ใครเลย)
 *   - เงินสดที่รับมาต้องไม่น้อยกว่ายอดของช่องทางเงินสดนั้น (`recordPosSale` → PAYMENT_FAILED)
 * ปล่อยให้กดแล้วล้ม แปลว่าบิลโต๊ะถูก claim เป็น CLOSING แล้วถูกคืนสถานะ ต่อหน้าลูกค้าที่ยืนรออยู่
 */
export function checkoutBlockReason(
  payments: readonly PosPaymentDraft[],
  amountDue: number,
): string | null {
  if (payments.length === 0) return "ต้องระบุช่องทางชำระเงิน";
  const total = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  if (Math.abs(total - amountDue) > 0.009) {
    return total < amountDue
      ? `ยอดชำระรวมยังขาด ฿${(amountDue - total).toFixed(2)}`
      : `ยอดชำระรวมเกินไป ฿${(total - amountDue).toFixed(2)}`;
  }
  for (const payment of payments) {
    if (!(Number(payment.amount) > 0)) return "ทุกช่องทางต้องระบุยอดที่มากกว่า 0";
    // เว้นว่าง = รับมาพอดี (server ยอมรับ) · ใส่มาแล้วน้อยกว่ายอด = ทอนติดลบ ซึ่งไม่มีอยู่จริง
    if (payment.method === "CASH" && payment.tendered.trim()
      && Number(payment.tendered) < Number(payment.amount)) {
      return "เงินสดที่รับมาน้อยกว่ายอดของช่องทางเงินสด";
    }
  }
  return null;
}
