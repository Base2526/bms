export type RestaurantKioskTraceRow = {
  id: string; service_mode: "DINE_IN" | "TAKEAWAY"; status: string;
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

/** The current check order is the sale candidate; later kitchen rounds can replace an earlier reservation. */
export function mapRestaurantKioskTrace(row: RestaurantKioskTraceRow, pickupLabel: string | null = null) {
  const settlement = row.status !== "ACCEPTED" ? "NOT_APPLICABLE"
    : row.order_status === "RETURNED" ? "RETURNED"
    : row.has_split_descendant ? "REVIEW"
    : row.check_status === "PAID" && row.order_status === "COMPLETED" && row.paid_at
      ? "PAID" : row.check_status === "OPEN" && row.order_status === "PENDING"
        ? "UNPAID" : "REVIEW";
  return {
    requestCode: row.id, serviceMode: row.service_mode, status: row.status,
    submittedAt: row.submitted_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewerName: row.reviewer_name, checkId: row.check_id, checkStatus: row.check_status,
    acceptedOrderId: row.accepted_order_id, currentOrderId: row.order_id,
    orderStatus: row.order_status, settlement,
    paidAt: settlement === "PAID" ? row.paid_at!.toISOString() : null,
    paymentIds: row.payment_ids ?? [], receiptId: row.receipt_id, receiptNo: row.receipt_no,
    receiptType: row.receipt_type,
    tableCode: row.table_code, tableName: row.table_name, areaName: row.area_name,
    splitGroupNo: row.split_group_no,
    hasSplitDescendant: row.has_split_descendant,
    pickupNumber: settlement === "PAID" ? pickupLabel : null,
    pickupStatus: row.queue_status,
  };
}
