import { useEffect, useRef } from 'react';
import { newAlertIds, shouldRepeatAlert } from '../lib/orderAlert';
import {
  fireOrderAlert,
  resetOrderAlertAcknowledgement,
  useOrderAlerts,
} from '../state/OrderAlertContext';
import { useIncomingOrders } from '../state/IncomingOrdersContext';
import { useKitchen } from '../state/KitchenContext';

/**
 * ตัวเฝ้าดูว่ามี "ของใหม่" เข้ามาไหม แล้วยิงแจ้งเตือน
 *
 * เรนเดอร์ครั้งเดียวใต้ provider ทั้งหมด (ไม่วาดอะไรเลย) — ถ้าเอา logic นี้ไปไว้ในหน้าจอ
 * มันจะเตือนเฉพาะตอนเปิดหน้านั้นอยู่ ซึ่งเป็นบั๊กที่ฝั่งเว็บเจอมาแล้ว: ป้ายและเสียงของจอครัว
 * ผูกกับ "แท็บที่เปิดอยู่" พนักงานที่ยืนหน้าผังโต๊ะจึงไม่มีวันรู้ว่ามีออร์เดอร์เข้า
 */
export function OrderAlertWatcher() {
  const { pendingIds, pendingCount } = useIncomingOrders();
  const { tickets } = useKitchen();
  return (
    <OrderAlertEffects
      pendingIds={pendingIds}
      pendingCount={pendingCount}
      tickets={tickets}
    />
  );
}

export function OrderAlertEffects({
  pendingIds,
  pendingCount,
  tickets,
}: {
  pendingIds: string[];
  pendingCount: number;
  tickets: Array<{ id: string; status: string }>;
}) {
  const { settings, lastAlertAtMs, acknowledged } = useOrderAlerts();

  // ⚠️ รอบแรกเป็นการ "ตั้งต้น" ไม่ใช่ของใหม่ — เปิดแอปมาเจอของค้างอยู่แล้วต้องไม่เตือนรัว
  const seenOrders = useRef<Set<string> | null>(null);
  const seenTickets = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seenOrders.current === null) {
      seenOrders.current = new Set(pendingIds);
      return;
    }
    const fresh = newAlertIds(seenOrders.current, pendingIds);
    seenOrders.current = new Set(pendingIds);
    if (fresh.length > 0) {
      resetOrderAlertAcknowledgement();
      fireOrderAlert('incoming_order');
    }
  }, [pendingIds]);

  useEffect(() => {
    // เตือนเฉพาะตั๋วที่ยังไม่มีใครเริ่มทำ — ตั๋วที่เลื่อนสถานะแล้วไม่ใช่ "ของใหม่"
    const openIds = tickets.filter(t => t.status === 'NEW').map(t => t.id);
    if (seenTickets.current === null) {
      seenTickets.current = new Set(openIds);
      return;
    }
    const fresh = newAlertIds(seenTickets.current, openIds);
    seenTickets.current = new Set(openIds);
    if (fresh.length > 0) fireOrderAlert('kitchen_ticket');
  }, [tickets]);

  // ย้ำซ้ำตราบใดที่ยังไม่มีใครรับทราบ — ออร์เดอร์ที่ไม่มีใครเห็นคือออร์เดอร์ที่หาย
  useEffect(() => {
    if (settings.repeatSeconds <= 0 || pendingCount === 0 || acknowledged) {
      return;
    }
    const timer = setInterval(() => {
      if (
        shouldRepeatAlert({
          pendingCount,
          lastAlertAtMs,
          nowMs: Date.now(),
          repeatSeconds: settings.repeatSeconds,
          acknowledged,
        })
      ) {
        fireOrderAlert('incoming_order');
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [acknowledged, lastAlertAtMs, pendingCount, settings.repeatSeconds]);

  return null;
}
