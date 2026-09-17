import { useEffect, useRef } from 'react';
import { newAlertIds, shouldRepeatAlert } from '../lib/orderAlert';
import {
  fireOrderAlert,
  resetOrderAlertAcknowledgement,
  useOrderAlerts,
} from '../state/OrderAlertContext';
import { useIncomingOrders } from '../state/IncomingOrdersContext';
import { useKitchen } from '../state/KitchenContext';
import { useRestaurantOperations } from '../state/RestaurantOperationsContext';
import { useBoardGameService } from '../state/BoardGameServiceContext';

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
  const {
    pendingQrIds,
    pendingServiceCallIds,
    activeWaitlistIds,
    initialized: restaurantOperationsInitialized,
  } = useRestaurantOperations();
  const {
    activeIds: boardGameServiceCallIds,
    initialized: boardGameServiceInitialized,
  } = useBoardGameService();
  return (
    <OrderAlertEffects
      pendingIds={pendingIds}
      pendingCount={pendingCount}
      tickets={tickets}
      qrIds={pendingQrIds}
      serviceCallIds={pendingServiceCallIds}
      boardGameServiceCallIds={boardGameServiceCallIds}
      waitlistIds={activeWaitlistIds}
      restaurantOperationsInitialized={restaurantOperationsInitialized}
      boardGameServiceInitialized={boardGameServiceInitialized}
    />
  );
}

export function OrderAlertEffects({
  pendingIds,
  pendingCount,
  tickets,
  qrIds = [],
  serviceCallIds = [],
  boardGameServiceCallIds = [],
  waitlistIds = [],
  restaurantOperationsInitialized = true,
  boardGameServiceInitialized = true,
}: {
  pendingIds: string[];
  pendingCount: number;
  tickets: Array<{ id: string; status: string }>;
  qrIds?: string[];
  serviceCallIds?: string[];
  boardGameServiceCallIds?: string[];
  waitlistIds?: string[];
  restaurantOperationsInitialized?: boolean;
  boardGameServiceInitialized?: boolean;
}) {
  const { settings, lastAlertAtMs, acknowledged } = useOrderAlerts();

  // ⚠️ รอบแรกเป็นการ "ตั้งต้น" ไม่ใช่ของใหม่ — เปิดแอปมาเจอของค้างอยู่แล้วต้องไม่เตือนรัว
  const seenOrders = useRef<Set<string> | null>(null);
  const seenTickets = useRef<Set<string> | null>(null);
  const seenQr = useRef<Set<string> | null>(null);
  const seenServiceCalls = useRef<Set<string> | null>(null);
  const seenWaitlist = useRef<Set<string> | null>(null);
  const seenBoardGameCalls = useRef<Set<string> | null>(null);

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

  useEffect(() => {
    if (!restaurantOperationsInitialized) {
      seenQr.current = null;
      seenServiceCalls.current = null;
      seenWaitlist.current = null;
      return;
    }
    if (
      seenQr.current === null ||
      seenServiceCalls.current === null ||
      seenWaitlist.current === null
    ) {
      seenQr.current = new Set(qrIds);
      seenServiceCalls.current = new Set(serviceCallIds);
      seenWaitlist.current = new Set(waitlistIds);
      return;
    }
    const freshQr = newAlertIds(seenQr.current, qrIds);
    const freshCalls = newAlertIds(seenServiceCalls.current, serviceCallIds);
    const freshWaitlist = newAlertIds(seenWaitlist.current, waitlistIds);
    seenQr.current = new Set(qrIds);
    seenServiceCalls.current = new Set(serviceCallIds);
    seenWaitlist.current = new Set(waitlistIds);
    if (freshCalls.length > 0) {
      resetOrderAlertAcknowledgement();
      fireOrderAlert('service_call');
    } else if (freshQr.length > 0) {
      resetOrderAlertAcknowledgement();
      fireOrderAlert('qr_order');
    } else if (freshWaitlist.length > 0) {
      resetOrderAlertAcknowledgement();
      fireOrderAlert('waitlist');
    }
  }, [qrIds, restaurantOperationsInitialized, serviceCallIds, waitlistIds]);

  useEffect(() => {
    if (!boardGameServiceInitialized) {
      seenBoardGameCalls.current = null;
      return;
    }
    if (seenBoardGameCalls.current === null) {
      seenBoardGameCalls.current = new Set(boardGameServiceCallIds);
      return;
    }
    const fresh = newAlertIds(
      seenBoardGameCalls.current,
      boardGameServiceCallIds,
    );
    seenBoardGameCalls.current = new Set(boardGameServiceCallIds);
    if (fresh.length > 0) {
      resetOrderAlertAcknowledgement();
      fireOrderAlert('service_call');
    }
  }, [boardGameServiceCallIds, boardGameServiceInitialized]);

  // ย้ำซ้ำตราบใดที่ยังไม่มีใครรับทราบ — ออร์เดอร์ที่ไม่มีใครเห็นคือออร์เดอร์ที่หาย
  useEffect(() => {
    const restaurantPendingCount =
      qrIds.length + serviceCallIds.length + waitlistIds.length;
    if (
      settings.repeatSeconds <= 0 ||
      pendingCount + restaurantPendingCount + boardGameServiceCallIds.length ===
        0 ||
      acknowledged
    ) {
      return;
    }
    const timer = setInterval(() => {
      if (
        shouldRepeatAlert({
          pendingCount:
            pendingCount +
            restaurantPendingCount +
            boardGameServiceCallIds.length,
          lastAlertAtMs,
          nowMs: Date.now(),
          repeatSeconds: settings.repeatSeconds,
          acknowledged,
        })
      ) {
        fireOrderAlert(
          serviceCallIds.length > 0 || boardGameServiceCallIds.length > 0
            ? 'service_call'
            : qrIds.length > 0
            ? 'qr_order'
            : waitlistIds.length > 0
            ? 'waitlist'
            : 'incoming_order',
        );
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [
    acknowledged,
    boardGameServiceCallIds.length,
    lastAlertAtMs,
    pendingCount,
    qrIds.length,
    serviceCallIds.length,
    settings.repeatSeconds,
    waitlistIds.length,
  ]);

  return null;
}
