export type MockPaymentMethod = 'cash' | 'qr' | 'card';

export interface MockPaymentInput {
  id: string;
  method: MockPaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
}

export interface MockPaymentValidation {
  paidTotal: number;
  remaining: number;
  overpaid: number;
  isBalanced: boolean;
  canConfirm: boolean;
  errors: string[];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function paymentMethodLabel(method: MockPaymentMethod): string {
  if (method === 'cash') return 'เงินสด';
  if (method === 'qr') return 'QR';
  return 'บัตรเครดิต';
}

export function validateMockPayments(
  totalDue: number,
  payments: MockPaymentInput[],
): MockPaymentValidation {
  const safeDue = roundMoney(Math.max(0, totalDue));
  const errors: string[] = [];
  const paidTotal = roundMoney(
    payments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0),
  );

  for (const payment of payments) {
    if (payment.amount <= 0) {
      errors.push(`${paymentMethodLabel(payment.method)} ต้องมียอดมากกว่า 0`);
    }
    if (payment.method === 'cash') {
      const tendered = payment.tendered ?? 0;
      if (tendered < payment.amount) {
        errors.push('เงินสดที่รับต้องไม่น้อยกว่ายอดเงินสด');
      }
    } else if (!payment.reference?.trim()) {
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

export function calculateCashChange(amount: number, tendered: number): number {
  return roundMoney(Math.max(0, tendered - amount));
}

export function quickCashAmounts(totalDue: number): number[] {
  const due = roundMoney(Math.max(0, totalDue));
  if (due === 0) return [];
  const bases = [due, 100, 500, 1000, Math.ceil(due / 100) * 100];
  return Array.from(new Set(bases.filter(value => value >= due))).slice(0, 4);
}
