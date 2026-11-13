import { posText, usePosLanguage } from '../i18n/language';
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobileKitchenTicketsDocument,
  MobileKitchenTicketStatusDocument,
  MobileKitchenTicketsStatusDocument,
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
  generatedAt: string | null;
  stationSlas: Record<string, { warnMinutes: number; lateMinutes: number }>;
  advanceTicket: (ticketId: string) => Promise<string | null>;
  rollbackTicket: (ticketId: string) => Promise<string | null>;
  setTicketsStatus: (
    ticketIds: string[],
    status: TicketStatus,
  ) => Promise<string | null>;
  refresh: () => Promise<void>;
}

const KitchenContext = createContext<KitchenContextValue | null>(null);

function knownStatus(value: string): TicketStatus {
  return value === 'PREPARING' || value === 'READY' || value === 'SERVED'
    ? value
    : 'NEW';
}

export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const language = usePosLanguage();
  const { session } = useSession();
  const operationInFlight = useRef(false);
  const query = useQuery(MobileKitchenTicketsDocument, {
    variables: { status: null },
    skip: !session,
    notifyOnNetworkStatusChange: true,
  });
  const [setStatus] = useMutation(MobileKitchenTicketStatusDocument);
  const [setStatuses] = useMutation(MobileKitchenTicketsStatusDocument);
  const tickets = useMemo<KitchenTicket[]>(
    () =>
      (query.data?.bmsPosKitchenTickets.tickets ?? [])
        .filter(ticket =>
          ['NEW', 'PREPARING', 'READY', 'SERVED'].includes(ticket.status),
        )
        .map(ticket => ({
          id: ticket.id,
          // เลขคิวรับของ (10.111) เป็นเลขที่ลูกค้าถือและหน้าร้านเรียก จึงขึ้นหัวใบแทนชื่อบิล
          tableCode: ticket.pickupQueueLabel
            ? posText("คิว {v0}", { v0: ticket.pickupQueueLabel }, language)
            : ticket.tableCode ?? ticket.tableName ?? posText("รับกลับ", undefined, language),
          roundNo: ticket.roundNo ?? 1,
          station: ticket.station ?? posText("ไม่ระบุสถานี", undefined, language),
          stationId: ticket.stationId ?? undefined,
          status: knownStatus(ticket.status),
          createdAt: ticket.updatedAt || ticket.createdAt,
          items: [
            {
              name: ticket.productName,
              qty: ticket.qty,
              size: ticket.size,
              modifierCodes: ticket.modifierCodes ?? [],
            },
          ],
          note: ticket.kitchenNote ?? undefined,
        })),
    [language, query.data],
  );
  const stations = useMemo(
    () =>
      (query.data?.bmsPosKitchenTickets.stations ?? []).map(
        station => station.name,
      ),
    [query.data],
  );
  const stationSlas = useMemo(
    () =>
      Object.fromEntries(
        (query.data?.bmsPosKitchenTickets.stationSlas ?? []).map(sla => [
          sla.stationRef,
          { warnMinutes: sla.warnMinutes, lateMinutes: sla.lateMinutes },
        ]),
      ),
    [query.data],
  );

  const move = useCallback(
    async (
      ticketId: string,
      choose: (status: TicketStatus) => TicketStatus | null,
    ) => {
      if (!session) return posText("กรุณาเข้าใช้งานใหม่");
      const ticket = tickets.find(item => item.id === ticketId);
      const next = ticket ? choose(ticket.status) : null;
      if (!ticket || !next) return posText("สถานะตั๋วไม่ถูกต้อง");
      if (operationInFlight.current) return posText("กำลังอัปเดตงานครัว กรุณารอสักครู่");
      operationInFlight.current = true;
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
          return result?.reason ?? result?.status ?? posText("เปลี่ยนสถานะไม่สำเร็จ");
        }
        await query.refetch().catch(() => undefined);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : posText("เปลี่ยนสถานะไม่สำเร็จ");
      } finally {
        operationInFlight.current = false;
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
  const setTicketsStatus = useCallback(
    async (ticketIds: string[], status: TicketStatus) => {
      if (!session) return posText("กรุณาเข้าใช้งานใหม่");
      if (!ticketIds.length) return null;
      if (operationInFlight.current) return posText("กำลังอัปเดตงานครัว กรุณารอสักครู่");
      operationInFlight.current = true;
      try {
        const response = await setStatuses({
          variables: {
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              userId: session.cashier.id,
              ticketIds,
              status,
            },
          },
        });
        const result = response.data?.bmsPosKitchenTicketsStatus;
        if (!result?.tickets)
          return result?.reason ?? result?.status ?? posText("เปลี่ยนสถานะไม่สำเร็จ");
        await query.refetch().catch(() => undefined);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : posText("เปลี่ยนสถานะไม่สำเร็จ");
      } finally {
        operationInFlight.current = false;
      }
    },
    [query, session, setStatuses],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  const value = useMemo<KitchenContextValue>(
    () => ({
      tickets,
      stations,
      loading: query.loading,
      error: query.error?.message ?? null,
      generatedAt: query.data?.bmsPosKitchenTickets.generatedAt ?? null,
      stationSlas,
      advanceTicket,
      rollbackTicket,
      setTicketsStatus,
      refresh,
    }),
    [advanceTicket,
      query.error?.message,
      query.loading,
      query.data?.bmsPosKitchenTickets.generatedAt,
      refresh,
      rollbackTicket,
      setTicketsStatus,
      stationSlas,
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
