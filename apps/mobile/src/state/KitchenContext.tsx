import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobileKitchenTicketsDocument,
  MobileKitchenTicketStatusDocument,
} from '../graphql/generated';
import {
  nextTicketStatus,
  previousTicketStatus,
  type KitchenTicket,
  type TicketStatus,
} from '../lib/kitchenBoard';
import { useSession } from './SessionContext';

interface KitchenContextValue {
  tickets: KitchenTicket[];
  stations: string[];
  loading: boolean;
  error: string | null;
  advanceTicket: (ticketId: string) => Promise<string | null>;
  rollbackTicket: (ticketId: string) => Promise<string | null>;
}

const KitchenContext = createContext<KitchenContextValue | null>(null);

function knownStatus(value: string): TicketStatus {
  return value === 'PREPARING' || value === 'READY' || value === 'SERVED'
    ? value
    : 'NEW';
}

export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const query = useQuery(MobileKitchenTicketsDocument, {
    variables: { status: null },
    skip: !session,
    notifyOnNetworkStatusChange: true,
  });
  const [setStatus] = useMutation(MobileKitchenTicketStatusDocument);
  const tickets = useMemo<KitchenTicket[]>(
    () =>
      (query.data?.bmsPosKitchenTickets.tickets ?? []).map(ticket => ({
        id: ticket.id,
        tableCode: ticket.tableCode ?? ticket.tableName ?? 'รับกลับ',
        roundNo: ticket.roundNo ?? 1,
        station: ticket.station ?? 'ไม่ระบุสถานี',
        status: knownStatus(ticket.status),
        createdAt: ticket.updatedAt || ticket.createdAt,
        items: [{ name: ticket.productName, qty: ticket.qty }],
        note: ticket.kitchenNote ?? undefined,
      })),
    [query.data],
  );
  const stations = useMemo(
    () =>
      (query.data?.bmsPosKitchenTickets.stations ?? []).map(
        station => station.name,
      ),
    [query.data],
  );

  const move = useCallback(
    async (
      ticketId: string,
      choose: (status: TicketStatus) => TicketStatus | null,
    ) => {
      if (!session) return 'กรุณาเข้าใช้งานใหม่';
      const ticket = tickets.find(item => item.id === ticketId);
      const next = ticket ? choose(ticket.status) : null;
      if (!ticket || !next) return 'สถานะตั๋วไม่ถูกต้อง';
      try {
        const response = await setStatus({
          variables: {
            input: {
              ticketId,
              status: next,
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              userId: session.cashier.id,
            },
          },
        });
        const result = response.data?.bmsPosKitchenTicketStatus;
        if (!result?.ticket) {
          return result?.reason ?? result?.status ?? 'เปลี่ยนสถานะไม่สำเร็จ';
        }
        await query.refetch();
        return null;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : 'เปลี่ยนสถานะไม่สำเร็จ';
      }
    },
    [query, session, setStatus, tickets],
  );

  const advanceTicket = useCallback(
    (ticketId: string) => move(ticketId, nextTicketStatus),
    [move],
  );
  const rollbackTicket = useCallback(
    (ticketId: string) => move(ticketId, previousTicketStatus),
    [move],
  );
  const value = useMemo<KitchenContextValue>(
    () => ({
      tickets,
      stations,
      loading: query.loading,
      error: query.error?.message ?? null,
      advanceTicket,
      rollbackTicket,
    }),
    [
      advanceTicket,
      query.error?.message,
      query.loading,
      rollbackTicket,
      stations,
      tickets,
    ],
  );
  return (
    <KitchenContext.Provider value={value}>{children}</KitchenContext.Provider>
  );
}

export function useKitchen(): KitchenContextValue {
  const context = useContext(KitchenContext);
  if (!context) throw new Error('useKitchen ต้องถูกเรียกใต้ <KitchenProvider>');
  return context;
}
