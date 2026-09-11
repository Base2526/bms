import type { RealtimeEventType } from "./events.js";

/**
 * Named domain subscriptions (Phase 6) — which event types each one forwards.
 *
 * This is contract data, not resolver logic: the GraphQL layer, the tests, and any
 * future client generator must agree on one table. It lives beside the event union so
 * a new event type and its subscription mapping are reviewed together.
 */
/** Event types each named subscription forwards. A type may appear in more than one. */
export const NAMED_REALTIME_SUBSCRIPTIONS: Readonly<Record<string, readonly RealtimeEventType[]>> = {
  bmsDeviceSessionChanged: ["device.session.changed"],
  // Drawer cash movement changes what the shift is expected to hold, so it
  // belongs to the shift view rather than a subscription of its own.
  bmsShiftChanged: ["shift.changed", "pos.cash_movement.recorded"],
  bmsPosOrderChanged: ["pos.order.changed"],
  bmsRestaurantFloorChanged: ["restaurant.floor.changed"],
  bmsRestaurantCheckChanged: [
    "restaurant.check.created", "restaurant.check.updated", "restaurant.round.sent",
    "restaurant.check.paid", "restaurant.check.cancelled",
  ],
  // Both kitchen queues: the board UNIONs them, so a client watching one table
  // would render a half-live board.
  bmsKitchenTicketChanged: [
    "restaurant.ticket.created", "restaurant.ticket.status_changed",
    "kitchen.ticket.created", "kitchen.ticket.status_changed",
  ],
  bmsMenuAvailabilityChanged: ["menu.availability.changed", "product.availability.changed"],
  bmsQrOrderChanged: ["restaurant.qr_submission.created", "restaurant.qr_submission.status_changed"],
  bmsIncomingOrderChanged: [
    "restaurant.customer_request.created", "restaurant.customer_request.accepted",
  ],
  bmsWaitlistChanged: ["waitlist.changed"],
  // แยกจากคิวรอโต๊ะโดยตั้งใจ: การเรียกพนักงานเป็นงานของโต๊ะที่นั่งอยู่แล้ว
  // ส่วนคิวคือคนที่ยังไม่ได้โต๊ะ — จอคนละจอและคนละคนที่ต้องตอบสนอง
  bmsServiceCallChanged: [
    "restaurant.table_call.created", "restaurant.table_call.status_changed",
  ],
  bmsInventoryChanged: ["inventory.changed", "inventory.reservation_changed"],
  bmsStockTransferChanged: ["inventory.transfer.sent", "inventory.transfer.received"],
  bmsStockCountChanged: ["inventory.count.applied"],
  bmsPaymentChanged: [
    "payment.submitted", "payment.confirmed", "payment.rejected",
    "payment.refund_pending", "payment.refunded",
  ],
  bmsOrderChanged: [
    "order.created", "order.status_changed", "order.paid", "order.cancelled",
    "order.fulfillment_changed", "order.line_cancelled",
  ],
  bmsNotificationCreated: ["notification.created"],
};