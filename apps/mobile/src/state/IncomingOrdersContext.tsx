import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobileRestaurantAcceptIncomingDocument,
  MobileRestaurantIncomingDocument,
} from '../graphql/generated';
import type { PosIncomingOrder } from '../types/pos';
import { useSession } from './SessionContext';
import { useStoreMode } from './StoreModeContext';

interface IncomingOrdersContextValue {
  orders: PosIncomingOrder[];
  pending: PosIncomingOrder[];
  pendingCount: number;
  pendingIds: string[];
  loading: boolean;
  error: string | null;
  acceptOrder: (id: string) => Promise<{ ticketsCreated: number } | string>;
  refresh: () => Promise<void>;
}

const IncomingOrdersContext =
  createContext<IncomingOrdersContextValue | null>(null);

export function IncomingOrdersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useSession();
  const { mode } = useStoreMode();
  const query = useQuery(MobileRestaurantIncomingDocument, {
    skip: !session || mode !== 'restaurant',
    notifyOnNetworkStatusChange: true,
  });
  const [accept] = useMutation(MobileRestaurantAcceptIncomingDocument);
  const orders = useMemo<PosIncomingOrder[]>(
    () =>
      (query.data?.bmsPosRestaurantIncoming.orders ?? []).map(order => ({
        id: order.id,
        channel: order.channel,
        customerName: order.customerRef ?? 'ลูกค้า',
        fulfillmentType: order.fulfillmentType,
        amountDue: order.amountDue,
        receivedAt: order.createdAt,
        promisedAt: order.promisedAt,
        status: order.status,
        lines: order.items.map(item => ({
          orderItemId: item.orderItemId,
          sku: item.sku,
          name: item.name ?? item.sku,
          qty: item.qty,
          size: item.size,
          unitName: item.unitName,
          modifierCodes: item.modifierCodes ?? [],
        })),
      })),
    [query.data],
  );
  const pending = useMemo(
    () => orders.filter(order => order.status === 'PAID'),
    [orders],
  );
  const pendingIds = useMemo(() => pending.map(order => order.id), [pending]);

  const acceptOrder = useCallback(
    async (id: string): Promise<{ ticketsCreated: number } | string> => {
      if (!session) return 'กรุณาเข้าใช้งานใหม่';
      try {
        const response = await accept({
          variables: {
            input: {
              orderId: id,
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
            },
          },
        });
        const result = response.data?.bmsPosRestaurantAcceptIncomingOrder;
        if (result?.status !== 'ACCEPTED') {
          return result?.reason ?? result?.status ?? 'รับออร์เดอร์ไม่สำเร็จ';
        }
        await query.refetch();
        return { ticketsCreated: result.ticketsCreated ?? 0 };
      } catch (error) {
        return error instanceof Error ? error.message : 'รับออร์เดอร์ไม่สำเร็จ';
      }
    },
    [accept, query, session],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  const value = useMemo<IncomingOrdersContextValue>(
    () => ({
      orders,
      pending,
      pendingCount: pending.length,
      pendingIds,
      loading: query.loading,
      error: query.error?.message ?? null,
      acceptOrder,
      refresh,
    }),
    [
      acceptOrder,
      orders,
      pending,
      pendingIds,
      query.error?.message,
      query.loading,
      refresh,
    ],
  );
  return (
    <IncomingOrdersContext.Provider value={value}>
      {children}
    </IncomingOrdersContext.Provider>
  );
}

export function useIncomingOrders(): IncomingOrdersContextValue {
  const context = useContext(IncomingOrdersContext);
  if (!context) {
    throw new Error(
      'useIncomingOrders ต้องถูกเรียกใต้ <IncomingOrdersProvider>',
    );
  }
  return context;
}
