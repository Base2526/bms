export type RestaurantKioskTraceRow = {
  id: string; service_mode: "DINE_IN" | "TAKEAWAY"; status: string; item_count: number;
  submitted_at: Date; reviewed_at: Date | null; reviewer_name: string | null;
  check_id: string | null; check_status: string | null; order_id: string | null;
  accepted_order_id: string | null;
  order_status: string | null; paid_at: Date | null; payment_ids: string[] | null;
  receipt_id: string | null; receipt_no: string | null; receipt_type: string | null;
  table_code: string | null; table_name: string | null; area_name: string | null;
  split_group_no: number | null; queue_prefix: string | null; queue_no: number | null;
  queue_status: string | null;
  has_split_descendant: boolean;
};

export type RestaurantKioskTraceLineRow = {
  submission_id: string; line_no: number; check_item_id: string;
  product_name: string; pack_qty: number; item_status: string;
  current_check_id: string; kitchen_status: string | null;
  check_status: string; order_id: string | null;
  order_status: string | null; paid_at: Date | null;
  order_item_id: string | null; returned_qty: number;
};

export function mapRestaurantKioskTraceLine(row: RestaurantKioskTraceLineRow) {
  const returnedQuantity = Number(row.returned_qty);
  const settlement = returnedQuantity >= Number(row.pack_qty) ? "RETURNED"
    : returnedQuantity > 0 ? "PARTIAL_RETURN"
    : row.item_status === "CANCELLED" ? "CANCELLED"
    : row.order_item_id && row.check_status === "PAID"
      && row.order_status === "COMPLETED" && row.paid_at ? "PAID"
    : row.order_item_id && row.check_status === "OPEN" && row.order_status === "PENDING"
      ? "UNPAID" : "REVIEW";
  return {
    lineNo: Number(row.line_no), checkItemId: row.check_item_id,
    productName: row.product_name, quantity: Number(row.pack_qty),
    currentCheckId: row.current_check_id, checkStatus: row.check_status,
    currentOrderId: row.order_id, orderStatus: row.order_status,
    kitchenStatus: row.kitchen_status, returnedQuantity,
    settlement, paidAt: settlement === "PAID" ? row.paid_at!.toISOString() : null,
  };
}

/** Line identities survive later kitchen rounds and check splits; legacy rows remain review-only. */
export function mapRestaurantKioskTrace(row: RestaurantKioskTraceRow, pickupLabel: string | null = null,
  lineRows: RestaurantKioskTraceLineRow[] = []) {
  const lines = lineRows.map(mapRestaurantKioskTraceLine);
  const complete = lines.length === Number(row.item_count) && lines.length > 0
    && lines.every((line, index) => line.lineNo === index + 1);
  const settlement = row.status !== "ACCEPTED" ? "NOT_APPLICABLE"
    : !complete ? "REVIEW"
    : lines.every((line) => line.settlement === "PAID") ? "PAID"
    : lines.every((line) => line.settlement === "UNPAID") ? "UNPAID"
    : lines.every((line) => line.settlement === "RETURNED") ? "RETURNED"
    : "REVIEW";
  const paidAt = settlement === "PAID" ? lines.map((line) => line.paidAt).filter((date): date is string => !!date).sort().at(-1) ?? null : null;
  return {
    requestCode: row.id, serviceMode: row.service_mode, status: row.status,
    submittedAt: row.submitted_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewerName: row.reviewer_name, checkId: row.check_id, checkStatus: row.check_status,
    acceptedOrderId: row.accepted_order_id, currentOrderId: row.order_id,
    orderStatus: row.order_status, settlement,
    paidAt, lineTraceComplete: complete, lines,
    paymentIds: row.payment_ids ?? [], receiptId: row.receipt_id, receiptNo: row.receipt_no,
    receiptType: row.receipt_type,
    tableCode: row.table_code, tableName: row.table_name, areaName: row.area_name,
    splitGroupNo: row.split_group_no,
    hasSplitDescendant: row.has_split_descendant,
    pickupNumber: settlement === "PAID" ? pickupLabel : null,
    pickupStatus: row.queue_status,
  };
}
