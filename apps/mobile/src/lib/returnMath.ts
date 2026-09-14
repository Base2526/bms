import type { MockPaymentInput, MockPaymentMethod } from './paymentMath';

interface ReturnableCartLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface MockReturnLineInput {
  sku: string;
  soldQty: number;
  returnQty: number;
  unitRefundPrice: number;
}

export interface MockRefundAllocation {
  id?: string;
  paymentId?: string;
  method: MockPaymentMethod;
  amount: number;
  status: 'COMPLETED' | 'PENDING';
  externalRef?: string;
}

interface ExchangeSourceLine {
  orderItemId: number;
  refundablePackQty: number;
}

interface ReturnedItem {
  orderItemId: number;
  packQty: number;
}

export interface ExchangeSeed<T extends ExchangeSourceLine> {
  key: string;
  line: T;
  qty: number;
}

export interface RefundPaymentOption {
  method: MockPaymentMethod;
  available: number;
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
      roundMoney(
        (consumedByMethod.get(allocation.method) ?? 0) + allocation.amount,
      ),
    );
  }
  for (const payment of payments) {
    if (remaining <= 0) break;
    const consumed = consumedByMethod.get(payment.method) ?? 0;
    const capacity = roundMoney(Math.max(0, payment.amount - consumed));
    consumedByMethod.set(
      payment.method,
      Math.max(0, consumed - payment.amount),
    );
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

export function wholeBillReturnLines(
  lines: ReturnableCartLine[],
): MockReturnLineInput[] {
  return lines.map(line => ({
    sku: line.sku,
    soldQty: line.qty,
    returnQty: line.qty,
    unitRefundPrice: line.unitPrice,
  }));
}

/** Build the replacement cart from the server-confirmed return, never from the draft selection. */
export function exchangeSeedLines<T extends ExchangeSourceLine>(
  orderId: string,
  lines: T[],
  returnedItems: ReturnedItem[],
): ExchangeSeed<T>[] {
  const returnedById = new Map(
    returnedItems
      .filter(
        item =>
          Number.isInteger(item.orderItemId) &&
          Number.isFinite(item.packQty) &&
          item.packQty > 0,
      )
      .map(item => [item.orderItemId, item.packQty]),
  );

  return lines.flatMap((line, index) => {
    const returnedQty = returnedById.get(line.orderItemId) ?? 0;
    const refundableQty = Number.isFinite(line.refundablePackQty)
      ? Math.max(0, line.refundablePackQty)
      : 0;
    const qty = Math.min(returnedQty, refundableQty);
    return qty > 0
      ? [
          {
            key: `exchange-${orderId}-${index}-${line.orderItemId}`,
            line,
            qty,
          },
        ]
      : [];
  });
}

/** Remaining refundable capacity per original payment method. */
export function refundPaymentOptions(
  payments: MockPaymentInput[],
  priorAllocations: MockRefundAllocation[],
): RefundPaymentOption[] {
  const allocatedByPayment = new Map<string, number>();
  for (const allocation of priorAllocations) {
    if (!allocation.paymentId) continue;
    allocatedByPayment.set(
      allocation.paymentId,
      roundMoney(
        (allocatedByPayment.get(allocation.paymentId) ?? 0) + allocation.amount,
      ),
    );
  }

  const availableByMethod = new Map<MockPaymentMethod, number>();
  for (const payment of payments) {
    const available = roundMoney(
      Math.max(0, payment.amount - (allocatedByPayment.get(payment.id) ?? 0)),
    );
    if (available <= 0.001) continue;
    availableByMethod.set(
      payment.method,
      roundMoney((availableByMethod.get(payment.method) ?? 0) + available),
    );
  }

  return [...availableByMethod.entries()].map(([method, available]) => ({
    method,
    available,
  }));
}
