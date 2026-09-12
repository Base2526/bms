import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { useQuery } from '@apollo/client';
import { MobilePosSalesDocument } from '../graphql/generated';
import type { MockPaymentInput } from '../lib/paymentMath';
import type { MockRefundAllocation } from '../lib/returnMath';
import type { PosCartLine, PosMember } from '../types/pos';
import { useSession } from './SessionContext';

export interface SaleLine extends PosCartLine {
  orderItemId: number;
  refundablePackQty: number;
  returnedPackQty: number;
}

export interface SaleReturnRecord {
  id: string;
  createdAt: string;
  type: 'RETURN' | 'VOID';
  reason: string;
  lines: SaleLine[];
  total: number;
  allocations: MockRefundAllocation[];
  settlementStatus: string;
}

export interface SaleSnapshot {
  id: string;
  receiptNo: string;
  createdAt: string;
  source: 'retail' | 'restaurant';
  tableCode?: string;
  lines: SaleLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  member: PosMember | null;
  payments: MockPaymentInput[];
  returns: SaleReturnRecord[];
  voided: boolean;
  returnEligible: boolean;
  returnBlockedReason: string | null;
}

interface SalesContextValue {
  sales: SaleSnapshot[];
  loading: boolean;
  error: string | null;
  findSale: (saleId: string) => SaleSnapshot | undefined;
  refresh: () => Promise<void>;
}

const SalesContext = createContext<SalesContextValue | null>(null);

function paymentMethod(value: string): MockPaymentInput['method'] {
  const normalized = value.toLowerCase();
  return normalized === 'cash' || normalized === 'card' ? normalized : 'qr';
}

export function SalesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const query = useQuery(MobilePosSalesDocument, {
    variables: { q: null, limit: 50 },
    skip: !session,
    notifyOnNetworkStatusChange: true,
  });

  const sales = useMemo<SaleSnapshot[]>(
    () =>
      (query.data?.bmsPosRecentSales.sales ?? []).map(receipt => {
        const lines: SaleLine[] = receipt.lines.map(line => ({
          key: String(line.orderItemId),
          orderItemId: line.orderItemId,
          sku: line.sku,
          name: line.receiptName,
          qty: line.packQty,
          unitPrice: line.packPrice,
          size: line.size,
          packCode: line.packCode,
          unitName: line.unitName,
          baseQty: line.baseQty,
          modifierCodes: [],
          serials: [],
          refundablePackQty: line.refundablePackQty,
          returnedPackQty: line.returnedPackQty,
        }));
        return {
          id: receipt.orderId,
          receiptNo: receipt.receiptNo ?? receipt.billNo ?? receipt.orderId,
          createdAt: receipt.soldAt,
          source: receipt.sourceChannel.includes('RESTAURANT')
            ? 'restaurant'
            : 'retail',
          lines,
          subtotal: lines.reduce(
            (sum, line) => sum + line.qty * line.unitPrice,
            0,
          ),
          discountTotal: receipt.discountLines.reduce(
            (sum, line) => sum + line.amount,
            0,
          ),
          total: receipt.total,
          member: receipt.memberName
            ? {
                id: '',
                memberNo: receipt.memberNo,
                name: receipt.memberName,
                phone: null,
                tier: null,
                tierDiscountPct: 0,
                points: 0,
                pointsUsable: 0,
              }
            : null,
          payments: receipt.payments.map(payment => ({
            id: payment.id,
            method: paymentMethod(payment.method),
            amount: payment.amount,
            tendered: payment.cashTendered ?? undefined,
            reference: payment.ref ?? undefined,
          })),
          returns: receipt.returnEvents.map(event => ({
            id: event.id,
            createdAt: event.returnedAt,
            type: event.isVoid ? 'VOID' : 'RETURN',
            reason: event.note ?? '',
            lines: event.items.map(item => {
              const original = lines.find(
                line => line.orderItemId === item.orderItemId,
              );
              return {
                key: String(item.orderItemId),
                orderItemId: item.orderItemId,
                sku: item.sku,
                name: item.receiptName,
                qty: item.packQty,
                unitPrice:
                  item.packQty > 0 ? item.refundAmount / item.packQty : 0,
                size: item.size,
                packCode: original?.packCode ?? '',
                unitName: original?.unitName ?? '',
                baseQty: original?.baseQty ?? 1,
                modifierCodes: [],
                serials: [],
                refundablePackQty: 0,
                returnedPackQty: item.packQty,
              };
            }),
            total: event.refundAmount,
            allocations: event.refunds.map(refund => ({
              method: paymentMethod(refund.method),
              amount: refund.amount,
              status: refund.completedAt ? 'COMPLETED' : 'PENDING',
            })),
            settlementStatus: event.settlementStatus,
          })),
          voided: Boolean(receipt.voidedAt),
          returnEligible: receipt.returnEligible,
          returnBlockedReason: receipt.returnBlockedReason,
        };
      }),
    [query.data],
  );

  const findSale = useCallback(
    (saleId: string) => sales.find(sale => sale.id === saleId),
    [sales],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  const value = useMemo<SalesContextValue>(
    () => ({
      sales,
      loading: query.loading,
      error: query.error?.message ?? null,
      findSale,
      refresh,
    }),
    [findSale, query.error?.message, query.loading, refresh, sales],
  );

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>;
}

export function useSales(): SalesContextValue {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales ต้องถูกเรียกใต้ <SalesProvider>');
  return context;
}
