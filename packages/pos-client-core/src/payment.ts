export type PosPaymentMethod =
  | "cash"
  | "qr"
  | "card"
  | "bank_transfer"
  | "wallet"
  | "store_credit"
  | "credit";

export interface PosPaymentInput {
  id: string;
  method: PosPaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
}

export interface PosPaymentValidation {
  paidTotal: number;
  remaining: number;
  overpaid: number;
  isBalanced: boolean;
  canConfirm: boolean;
  errors: string[];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function paymentMethodLabel(method: PosPaymentMethod): string {
  if (method === "cash") return "เงินสด";
  if (method === "qr") return "QR";
  if (method === "card") return "บัตรเครดิต";
  if (method === "bank_transfer") return "โอนเงิน";
  if (method === "wallet") return "วอลเล็ท";
  if (method === "store_credit") return "เครดิตร้าน";
  return "ขายเชื่อ";
}

export function validatePayments(
  totalDue: number,
  payments: PosPaymentInput[],
): PosPaymentValidation {
  const safeDue = roundMoney(Math.max(0, totalDue));
  const errors: string[] = [];
  const paidTotal = roundMoney(
    payments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0),
  );
  for (const payment of payments) {
    if (payment.amount <= 0) errors.push(`${paymentMethodLabel(payment.method)} ต้องมียอดมากกว่า 0`);
    if (payment.method === "cash") {
      if ((payment.tendered ?? 0) < payment.amount) errors.push("เงินสดที่รับต้องไม่น้อยกว่ายอดเงินสด");
    } else if (payment.method !== "credit" && !payment.reference?.trim()) {
      errors.push(`${paymentMethodLabel(payment.method)} ต้องมีเลขอ้างอิงทดสอบ`);
    }
  }
  const diff = roundMoney(safeDue - paidTotal);
  const remaining = Math.max(0, diff);
  const overpaid = Math.max(0, roundMoney(-diff));
  if (remaining > 0) errors.push(`ยังขาด ฿${remaining.toFixed(2)}`);
  if (overpaid > 0) errors.push(`ยอดชำระเกิน ฿${overpaid.toFixed(2)}`);
  return {
    paidTotal,
    remaining,
    overpaid,
    isBalanced: remaining === 0 && overpaid === 0,
    canConfirm: safeDue > 0 && payments.length > 0 && errors.length === 0,
    errors,
  };
}

/** Backward-compatible name used by the native client tests and screens. */
export const validateMockPayments = validatePayments;

export function calculateCashChange(amount: number, tendered: number): number {
  return roundMoney(Math.max(0, tendered - amount));
}

export function quickCashAmounts(totalDue: number): number[] {
  const due = roundMoney(Math.max(0, totalDue));
  if (due === 0) return [];
  const rounded = Math.ceil(due / 100) * 100;
  return Array.from(new Set([due, rounded, 100, 500, 1000].filter((value) => value >= due))).slice(0, 4);
}

export type MockPaymentMethod = PosPaymentMethod;
export type MockPaymentInput = PosPaymentInput;
export type MockPaymentValidation = PosPaymentValidation;
