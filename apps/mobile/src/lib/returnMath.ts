import type { MockCartLine } from '../mocks/menu';
import type { MockPaymentInput, MockPaymentMethod } from './paymentMath';

export interface MockReturnLineInput {
  sku: string;
  soldQty: number;
  returnQty: number;
  unitPrice: number;
}

export interface MockRefundAllocation {
  method: MockPaymentMethod;
  amount: number;
  status: 'COMPLETED' | 'PENDING';
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculateMockReturnTotal(lines: MockReturnLineInput[]): {
  total: number;
  errors: string[];
} {
  const errors: string[] = [];
  let total = 0;
  for (const line of lines) {
    if (line.returnQty < 0) errors.push(`${line.sku} จำนวนคืนต้องไม่ติดลบ`);
    if (line.returnQty > line.soldQty) {
      errors.push(`${line.sku} จำนวนคืนมากกว่าที่ขาย`);
    }
    total += Math.max(0, line.returnQty) * line.unitPrice;
  }
  return { total: roundMoney(total), errors };
}

export function allocateMockRefundToOriginalPayments(
  refundTotal: number,
  payments: MockPaymentInput[],
): MockRefundAllocation[] {
  let remaining = roundMoney(Math.max(0, refundTotal));
  const allocations: MockRefundAllocation[] = [];
  for (const payment of payments) {
    if (remaining <= 0) break;
    const amount = roundMoney(Math.min(remaining, payment.amount));
    if (amount > 0) {
      allocations.push({
        method: payment.method,
        amount,
        status: payment.method === 'cash' ? 'COMPLETED' : 'PENDING',
      });
      remaining = roundMoney(remaining - amount);
    }
  }
  return allocations;
}

export function wholeBillReturnLines(lines: MockCartLine[]): MockReturnLineInput[] {
  return lines.map(line => ({
    sku: line.sku,
    soldQty: line.qty,
    returnQty: line.qty,
    unitPrice: line.unitPrice,
  }));
}
