import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  mockIncomingOrderTemplates,
  type IncomingOrderChannel,
  type MockIncomingOrder,
} from '../mocks/incomingOrders';

// คิว "ออร์เดอร์เข้า" — ข้อเสนอจากแชท/ออนไลน์/QR ที่โต๊ะ ที่ยังต้องมีคนกดรับ
//
// ⚠️ ยังไม่มี network: ออร์เดอร์เข้ามาได้ทางเดียวคือปุ่ม "จำลองออร์เดอร์เข้า" ในจอคิว
// ตอนต่อ backend ให้แทน `simulateArrival` ด้วย subscription/poll จริง โดยจุดเรียกที่หน้าจอ
// และเส้นทางแจ้งเตือนไม่ต้องแก้เลย
//
// ⚠️ ห้ามให้ออร์เดอร์ที่เข้ามากลายเป็นงานของครัวเอง — ต้องมีคนกดรับก่อนเสมอ
// (กฎเดียวกับฝั่งเว็บ: การจ่ายเงินไม่เคยสร้างงานครัว มีแต่การกดรับของคนเท่านั้น)

interface IncomingOrdersContextValue {
  orders: MockIncomingOrder[];
  pending: MockIncomingOrder[];
  pendingCount: number;
  /** id ของใบที่รออยู่ — ใช้เทียบว่ามีใบใหม่โผล่ไหม */
  pendingIds: string[];
  simulateArrival: (channel?: IncomingOrderChannel) => MockIncomingOrder;
  acceptOrder: (id: string) => MockIncomingOrder | null;
  rejectOrder: (id: string, reason: string) => string | null;
}

const IncomingOrdersContext = createContext<IncomingOrdersContextValue | null>(
  null,
);

export function IncomingOrdersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [orders, setOrders] = useState<MockIncomingOrder[]>([]);

  const simulateArrival = useCallback((channel?: IncomingOrderChannel) => {
    const pool = channel
      ? mockIncomingOrderTemplates.filter(t => t.channel === channel)
      : mockIncomingOrderTemplates;
    const template =
      pool[Math.floor(Math.random() * pool.length)] ??
      mockIncomingOrderTemplates[0];
    const order: MockIncomingOrder = {
      ...template,
      lines: template.lines.map(line => ({ ...line })),
      id: `incoming-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      receivedAt: new Date().toISOString(),
      status: 'PENDING',
    };
    setOrders(prev => [order, ...prev]);
    return order;
  }, []);

  const acceptOrder = useCallback((id: string) => {
    let accepted: MockIncomingOrder | null = null;
    setOrders(prev =>
      prev.map(order => {
        if (order.id !== id || order.status !== 'PENDING') return order;
        accepted = { ...order, status: 'ACCEPTED' };
        return accepted;
      }),
    );
    return accepted;
  }, []);

  const rejectOrder = useCallback((id: string, reason: string) => {
    // ⚠️ เหตุผลบังคับ — ลูกค้าที่ถูกปฏิเสธต้องได้คำตอบว่าทำไม (กฎเดียวกับฝั่งเว็บ)
    if (!reason.trim()) return 'ต้องระบุเหตุผลที่ปฏิเสธ';
    setOrders(prev =>
      prev.map(order =>
        order.id === id && order.status === 'PENDING'
          ? { ...order, status: 'REJECTED', rejectReason: reason.trim() }
          : order,
      ),
    );
    return null;
  }, []);

  const pending = useMemo(
    () => orders.filter(order => order.status === 'PENDING'),
    [orders],
  );
  const pendingIds = useMemo(() => pending.map(order => order.id), [pending]);

  const value = useMemo<IncomingOrdersContextValue>(
    () => ({
      orders,
      pending,
      pendingCount: pending.length,
      pendingIds,
      simulateArrival,
      acceptOrder,
      rejectOrder,
    }),
    [acceptOrder, orders, pending, pendingIds, rejectOrder, simulateArrival],
  );

  return (
    <IncomingOrdersContext.Provider value={value}>
      {children}
    </IncomingOrdersContext.Provider>
  );
}

export function useIncomingOrders(): IncomingOrdersContextValue {
  const ctx = useContext(IncomingOrdersContext);
  if (!ctx) {
    throw new Error(
      'useIncomingOrders ต้องถูกเรียกใต้ <IncomingOrdersProvider>',
    );
  }
  return ctx;
}
