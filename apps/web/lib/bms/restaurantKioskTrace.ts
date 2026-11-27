import { kioskTenantRead } from "./restaurantKioskTenantRead";
import { normalizeKioskRequestCode } from "./restaurantKioskReview";
import { mapRestaurantKioskTrace, type RestaurantKioskTraceLineRow, type RestaurantKioskTraceRow } from "./restaurantKioskTraceView";
import { formatPickupQueueNo } from "./pickupQueue";

/** Manager read: bounded, branch scoped and free of customer notes, URLs and credentials. */
export async function listRestaurantKioskTrace(tenantId: string, locationId: string, requestCode = "") {
  const code = normalizeKioskRequestCode(requestCode);
  return kioskTenantRead(tenantId, async (client) => {
    const result = await client.query<RestaurantKioskTraceRow>(
    `SELECT s.id, s.service_mode, jsonb_array_length(s.items) AS item_count,
            CASE WHEN s.status = 'PENDING' AND s.submitted_at <= now() - interval '30 minutes'
                 THEN 'EXPIRED' ELSE s.status END AS status,
            s.submitted_at, s.reviewed_at, reviewer.name AS reviewer_name,
            s.check_id, s.accepted_order_id, c.status AS check_status, c.current_order_id AS order_id,
            o.status AS order_status, o.paid_at,
            pay.payment_ids, doc.id AS receipt_id, doc.doc_no AS receipt_no,
            doc.doc_type AS receipt_type,
            t.code AS table_code, t.name AS table_name, a.name AS area_name,
            c.split_group_no, pq.queue_prefix, pq.queue_no, pq.status AS queue_status,
            EXISTS (SELECT 1 FROM bms_restaurant_checks child
                     WHERE child.tenant_id = s.tenant_id AND child.location_id = s.location_id
                       AND child.split_from_check_id = s.check_id
                       AND child.opened_at > s.reviewed_at) AS has_split_descendant
       FROM bms_restaurant_kiosk_submissions s
       LEFT JOIN bms_restaurant_checks c
         ON c.tenant_id = s.tenant_id AND c.location_id = s.location_id AND c.id = s.check_id
       LEFT JOIN bms_orders o
         ON o.tenant_id = c.tenant_id AND o.location_id = c.location_id
        AND o.id = c.current_order_id AND o.restaurant_check_id = c.id
       LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by AND reviewer.tenant_id = s.tenant_id
       LEFT JOIN bms_restaurant_tables t
         ON t.tenant_id = c.tenant_id AND t.location_id = c.location_id AND t.id = c.table_id
       LEFT JOIN bms_restaurant_areas a ON a.tenant_id = t.tenant_id AND a.id = t.area_id
       LEFT JOIN LATERAL (
         SELECT array_agg(p.id::text ORDER BY p.created_at, p.id) AS payment_ids
           FROM bms_payments p
          WHERE p.tenant_id = o.tenant_id AND p.order_id = o.id
            AND p.status IN ('CONFIRMED', 'REFUNDED')
       ) pay ON TRUE
       LEFT JOIN LATERAL (
         SELECT d.id, d.doc_no, d.doc_type
           FROM bms_tax_documents d
          WHERE d.tenant_id = o.tenant_id AND d.location_id = s.location_id
            AND d.order_id = o.id AND d.doc_type IN ('ABBREVIATED', 'FULL')
            AND d.cancelled_at IS NULL
          ORDER BY CASE WHEN d.doc_type = 'FULL' THEN 0 ELSE 1 END,
                   d.issued_at DESC, d.id DESC LIMIT 1
       ) doc ON TRUE
       LEFT JOIN bms_pickup_queue pq
         ON pq.tenant_id = o.tenant_id AND pq.location_id = s.location_id AND pq.order_id = o.id
      WHERE s.tenant_id = $1 AND s.location_id = $2
        AND ($3::text = '' OR s.id::text LIKE $3 || '%')
        AND ($3::text <> '' OR s.submitted_at > now() - interval '24 hours')
      ORDER BY s.submitted_at DESC, s.id DESC LIMIT ${code ? 10 : 100}`,
    [tenantId, locationId, code]
    );
    if (!result.rows.length) return [];
    const lines = await client.query<RestaurantKioskTraceLineRow>(
      `SELECT m.submission_id, m.line_no, m.check_item_id,
              i.product_name, i.pack_qty, i.status AS item_status,
              i.check_id AS current_check_id, kt.status AS kitchen_status,
              c.status AS check_status, c.current_order_id AS order_id,
              o.status AS order_status, o.paid_at, oi.id AS order_item_id,
              COALESCE(ret.returned_qty, 0)::int AS returned_qty
         FROM bms_restaurant_kiosk_submission_items m
         JOIN bms_restaurant_check_items i
           ON i.tenant_id = m.tenant_id AND i.id = m.check_item_id
         JOIN bms_restaurant_checks c
           ON c.tenant_id = i.tenant_id AND c.id = i.check_id
          AND c.location_id = m.location_id
         LEFT JOIN bms_restaurant_kitchen_tickets kt
           ON kt.tenant_id = i.tenant_id AND kt.check_item_id = i.id
         LEFT JOIN bms_orders o
           ON o.tenant_id = c.tenant_id AND o.location_id = c.location_id
          AND o.id = c.current_order_id AND o.restaurant_check_id = c.id
         LEFT JOIN bms_order_items oi
           ON oi.tenant_id = o.tenant_id AND oi.order_id = o.id
          AND oi.restaurant_check_item_id = i.id
         LEFT JOIN LATERAL (
           SELECT SUM(COALESCE(pri.pack_qty, pri.qty)) AS returned_qty
             FROM bms_pos_return_items pri
            WHERE pri.tenant_id = m.tenant_id AND pri.order_item_id = oi.id
         ) ret ON TRUE
        WHERE m.tenant_id = $1 AND m.location_id = $2
          AND m.submission_id = ANY($3::uuid[])
        ORDER BY m.submission_id, m.line_no`,
      [tenantId, locationId, result.rows.map((row) => row.id)]
    );
    const bySubmission = new Map<string, RestaurantKioskTraceLineRow[]>();
    for (const line of lines.rows) {
      const bucket = bySubmission.get(line.submission_id) ?? [];
      bucket.push(line);
      bySubmission.set(line.submission_id, bucket);
    }
    return result.rows.map((row) => mapRestaurantKioskTrace(row,
      row.queue_no == null ? null : formatPickupQueueNo(row.queue_no, row.queue_prefix ?? ""),
      bySubmission.get(row.id) ?? []));
  });
}
