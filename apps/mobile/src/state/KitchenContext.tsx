import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  groupRoundByStation,
  nextRoundNo,
  nextTicketStatus,
  previousTicketStatus,
  type KitchenTicket,
  type RoundLineInput,
  type TicketStatus,
} from '../lib/kitchenBoard';
import { mockKitchenSeedTickets } from '../mocks/kitchenTickets';
import { restaurantMockCatalog } from '../mocks/menu';

// ตั๋วครัวของรอบที่เปิดแอป
//
// ⚠️ ตั๋วในโครงนี้เกิดฝั่ง client ล้วน ๆ — ไม่มีการจองสต็อกและไม่ได้อยู่ในทรานแซกชันเดียวกับบิล
// แบบฝั่งเว็บ (`enqueueKitchenTicketsInTx`) ตอนต่อ backend ต้องย้ายการสร้างตั๋วไปอยู่กับ
// mutation ส่งครัว แล้วชั้นนี้เหลือแค่ cache ของผลลัพธ์
//
// เหตุที่ต้องมี: ก่อนหน้านี้จอครัวอ่าน `mocks/kitchenTickets` ตรง ๆ กด "ส่งครัว" ที่บิลโต๊ะแล้ว
// ไม่มีอะไรขยับเลยทั้งแอป และจอครัวก็แตะอะไรไม่ได้เลยสักปุ่ม = แท็บที่เปิดมาดูเฉย ๆ

const STATION_BY_SKU = new Map(
  restaurantMockCatalog.items.map(item => [item.sku, item.station] as const),
);

/** สถานีสำรองเมื่อ sku ไม่มีในแคตตาล็อก — อาหารต้องไม่หายจากกระดานเพราะข้อมูลไม่ครบ */
const FALLBACK_STATION = 'ไม่ระบุสถานี';

interface KitchenContextValue {
  tickets: KitchenTicket[];
  /** คืนจำนวนตั๋วที่ออก (หนึ่งใบต่อสถานี) */
  enqueueRound: (tableCode: string, lines: RoundLineInput[]) => number;
  advanceTicket: (ticketId: string) => void;
  rollbackTicket: (ticketId: string) => void;
}

const KitchenContext = createContext<KitchenContextValue | null>(null);

export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const [tickets, setTickets] = useState<KitchenTicket[]>(() => {
    const now = Date.now();
    return mockKitchenSeedTickets.map(seed => ({
      id: seed.id,
      tableCode: seed.tableCode,
      roundNo: seed.roundNo,
      station: seed.station,
      status: seed.status,
      createdAt: new Date(now - seed.minutesAgo * 60000).toISOString(),
      items: seed.items,
      note: seed.note,
    }));
  });

  const enqueueRound = useCallback(
    (tableCode: string, lines: RoundLineInput[]) => {
      const groups = groupRoundByStation(
        lines,
        sku => STATION_BY_SKU.get(sku),
        FALLBACK_STATION,
      );
      if (groups.length === 0) return 0;
      setTickets(prev => {
        const roundNo = nextRoundNo(prev, tableCode);
        const createdAt = new Date().toISOString();
        const created = groups.map((group, index) => ({
          id: `kt-${Date.now()}-${index}`,
          tableCode,
          roundNo,
          station: group.station,
          status: 'NEW' as TicketStatus,
          createdAt,
          items: group.items,
        }));
        return [...created, ...prev];
      });
      return groups.length;
    },
    [],
  );

  const moveTicket = useCallback(
    (ticketId: string, pick: (status: TicketStatus) => TicketStatus | null) => {
      setTickets(prev =>
        prev.map(ticket => {
          if (ticket.id !== ticketId) return ticket;
          const next = pick(ticket.status);
          if (!next) return ticket;
          // เวลาที่แสดงบนตั๋วนับจากการเปลี่ยนสถานะครั้งล่าสุด — "พร้อมเสิร์ฟมากี่นาที"
          // เป็นคำถามคนละข้อกับ "สั่งมากี่นาที" และเป็นข้อที่ครัวใช้ตัดสินใจจริง
          return {
            ...ticket,
            status: next,
            createdAt: new Date().toISOString(),
          };
        }),
      );
    },
    [],
  );

  const advanceTicket = useCallback(
    (ticketId: string) => moveTicket(ticketId, nextTicketStatus),
    [moveTicket],
  );
  const rollbackTicket = useCallback(
    (ticketId: string) => moveTicket(ticketId, previousTicketStatus),
    [moveTicket],
  );

  const value = useMemo<KitchenContextValue>(
    () => ({ tickets, enqueueRound, advanceTicket, rollbackTicket }),
    [advanceTicket, enqueueRound, rollbackTicket, tickets],
  );

  return (
    <KitchenContext.Provider value={value}>{children}</KitchenContext.Provider>
  );
}

export function useKitchen(): KitchenContextValue {
  const ctx = useContext(KitchenContext);
  if (!ctx) throw new Error('useKitchen ต้องถูกเรียกใต้ <KitchenProvider>');
  return ctx;
}
