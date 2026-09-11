import type { MockCartLine } from '../mocks/menu';
import type { MockPaymentInput, MockPaymentMethod } from './paymentMath';

export interface MockReturnLineInput {
  sku: string;
  soldQty: number;
  returnQty: number;
  unitRefundPrice: number;
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
    total += Math.max(0, line.returnQty) * line.unitRefundPrice;
  }
  return { total: roundMoney(total), errors };
}

export function allocateMockRefundToOriginalPayments(
  refundTotal: number,
  payments: MockPaymentInput[],
  priorAllocations: MockRefundAllocation[] = [],
): MockRefundAllocation[] {
  let remaining = roundMoney(Math.max(0, refundTotal));
  const allocations: MockRefundAllocation[] = [];
  const consumedByMethod = new Map<MockPaymentMethod, number>();
  for (const allocation of priorAllocations) {
    consumedByMethod.set(
      allocation.method,
      roundMoney((consumedByMethod.get(allocation.method) ?? 0) + allocation.amount),
    );
  }
  for (const payment of payments) {
    if (remaining <= 0) break;
    const consumed = consumedByMethod.get(payment.method) ?? 0;
    const capacity = roundMoney(Math.max(0, payment.amount - consumed));
    consumedByMethod.set(payment.method, Math.max(0, consumed - payment.amount));
    const amount = roundMoney(Math.min(remaining, capacity));
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
    unitRefundPrice: line.unitPrice,
  }));
}
