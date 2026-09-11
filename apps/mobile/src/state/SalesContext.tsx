import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { MockCoupon, MockMember } from '../mocks/checkout';
import type { MockCartLine } from '../mocks/menu';
import type { ManualDiscount } from '../lib/checkoutMath';
import type { MockPaymentInput } from '../lib/paymentMath';
import type { MockRefundAllocation } from '../lib/returnMath';

export interface MockSaleSnapshot {
  id: string;
  receiptNo: string;
  createdAt: string;
  source: 'retail' | 'restaurant';
  tableId?: string;
  tableCode?: string;
  lines: MockCartLine[];
  subtotal: number;
  tierDiscount: number;
  couponDiscount: number;
  manualDiscountAmount: number;
  discountTotal: number;
  total: number;
  member: MockMember | null;
  coupon: MockCoupon | null;
  manualDiscount: ManualDiscount | null;
  payments: MockPaymentInput[];
  returns: MockReturnRecord[];
  voided: boolean;
}

export interface MockReturnRecord {
  id: string;
  createdAt: string;
  type: 'RETURN' | 'VOID';
  reason: string;
  lines: MockCartLine[];
  total: number;
  allocations: MockRefundAllocation[];
}

interface SalesContextValue {
  sales: MockSaleSnapshot[];
  recordSale: (sale: Omit<MockSaleSnapshot, 'id' | 'receiptNo' | 'createdAt' | 'returns' | 'voided'>) => MockSaleSnapshot;
  findSale: (saleId: string) => MockSaleSnapshot | undefined;
  appendReturn: (saleId: string, record: Omit<MockReturnRecord, 'id' | 'createdAt'>) => void;
}

const SalesContext = createContext<SalesContextValue | null>(null);

export function SalesProvider({ children }: { children: React.ReactNode }) {
  const [sales, setSales] = useState<MockSaleSnapshot[]>([]);

  const recordSale = useCallback(
    (sale: Omit<MockSaleSnapshot, 'id' | 'receiptNo' | 'createdAt' | 'returns' | 'voided'>) => {
      const id = `sale-${Date.now()}`;
      const snapshot: MockSaleSnapshot = {
        ...sale,
        id,
        receiptNo: `TEST-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`,
        createdAt: new Date().toISOString(),
        returns: [],
        voided: false,
      };
      setSales(prev => [snapshot, ...prev]);
      return snapshot;
    },
    [],
  );

  const findSale = useCallback(
    (saleId: string) => sales.find(sale => sale.id === saleId),
    [sales],
  );

  const appendReturn = useCallback(
    (saleId: string, record: Omit<MockReturnRecord, 'id' | 'createdAt'>) => {
      setSales(prev =>
        prev.map(sale => {
          if (sale.id !== saleId) return sale;
          const nextRecord: MockReturnRecord = {
            ...record,
            id: `return-${Date.now()}`,
            createdAt: new Date().toISOString(),
          };
          return {
            ...sale,
            voided: sale.voided || record.type === 'VOID',
            returns: [nextRecord, ...sale.returns],
          };
        }),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({ sales, recordSale, findSale, appendReturn }),
    [appendReturn, findSale, recordSale, sales],
  );

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>;
}

export function useSales(): SalesContextValue {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error('useSales ต้องถูกเรียกใต้ <SalesProvider>');
  return ctx;
}
