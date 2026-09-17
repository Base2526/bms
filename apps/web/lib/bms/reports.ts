// =============================================================
// BMS Reports — report tools แยกส่วน (TOOLS.md §Reports)
// -------------------------------------------------------------
// getSalesSummary(from,to)  : ยอดขายช่วงวันที่ (revenue/orders/by-day/status/channel)
// getInventorySummary()     : สรุปสต็อก (มูลค่า, ใกล้หมด, หมด)
// getTopSellingProducts()   : สินค้าขายดีในช่วงวันที่
//
// revenue นับใบเสร็จที่เคยจ่ายแล้ว รวม RETURNED ไว้เป็นยอดขายตั้งต้น แล้วหัก refund event
// แยกต่างหาก มิฉะนั้นบิลคืนเต็มจะถูกลบสองครั้ง (หายจากยอดขายและถูกหักคืนเงินซ้ำ)
// tenant-scoped ทุก query — ตรงกับหลักใน dashboard.ts
// =============================================================

import { query } from "@/lib/db";
import { getArOutstanding } from "./ar";
import { loyaltyOutstandingReport } from "./membership";
import { getStoreCreditOutstanding } from "./storeCredit";
import { getLocation } from "./locations";
import { normalizeShopArchetype, type ShopArchetype } from "./shopArchetypes";

const PAID = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
// A RETURNED order was still a paid receipt. Keep the receipt and its later
// refund as separate financial events.
const FINANCIAL_ORDER_STATUSES = [...PAID, "RETURNED"];
const RETURN_REASON_PREFIX_RE = /^\[([A-Z_]+)\]\s*/;
const BANGKOK_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function bangkokDateKey(value: Date): string {
  const parts = BANGKOK_DATE_FORMATTER.formatToParts(value);
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDateKeyDays(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function assertDateKey(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} ต้องเป็น YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} เป็นวันที่ไม่ถูกต้อง`);
  }
  return value;
}

function parseReturnReason(note: string | null | undefined) {
  const text = String(note ?? "").trim();
  const match = text.match(RETURN_REASON_PREFIX_RE);
  return {
    reasonCode: match?.[1] ?? "UNSPECIFIED",
    reasonText: text.replace(RETURN_REASON_PREFIX_RE, "") || "(no detail)",
  };
}

/** normalize ช่วงวันที่ธุรกิจ Asia/Bangkok: default = 30 วันล่าสุด (YYYY-MM-DD) */
function range(from?: string | null, to?: string | null): { from: string; to: string } {
  const toD = assertDateKey(from && to ? to : to || bangkokDateKey(new Date()), "to");
  const fromD = assertDateKey(from || addDateKeyDays(toD, -29), "from");
  if (fromD > toD) throw new Error("from ต้องไม่อยู่หลัง to");
  const spanDays = Math.round((Date.parse(`${toD}T00:00:00Z`) - Date.parse(`${fromD}T00:00:00Z`)) / 86_400_000);
  if (spanDays > 366) throw new Error("ช่วงรายงานต้องไม่เกิน 367 วัน");
  return { from: fromD, to: toD };
}

export async function getSalesSummary(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  locationId?: string | null
) {
  const r = range(from, to);

  const [totals, refunds, byDay, byStatus, byChannel] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue,
              COUNT(*)::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1 AND status = ANY($2)
          AND ($5::uuid IS NULL OR location_id = $5::uuid)
          AND COALESCE(paid_at, created_at) >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND COALESCE(paid_at, created_at) < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      [tenantId, FINANCIAL_ORDER_STATUSES, r.from, r.to, locationId || null]
    ),
    query(
      `WITH raw_refund_events AS (
         -- POS supports partial/split refunds, so the completed allocation is
         -- the money event. Counting its parent payment would miss partials
         -- and double-count a fully refunded split payment.
         SELECT pr.order_id, 'pos:' || a.id::text AS event_id, a.amount,
                o.total_amount, pr.return_location_id AS location_id,
                COALESCE(a.completed_at, a.updated_at) AS occurred_at
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE a.tenant_id=$1 AND a.status='COMPLETED'
         UNION ALL
         SELECT p.order_id, 'payment:' || p.id::text AS event_id, p.amount,
                o.total_amount, o.location_id,
                COALESCE(p.refunded_at,p.updated_at) AS occurred_at
           FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='REFUNDED'
            AND NOT EXISTS (
              SELECT 1 FROM bms_pos_refund_allocations a
               WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id
            )
       ), refund_events AS (
         -- Payments and full POS refunds may include shipping/rounding while
         -- this report's revenue is merchandise-only. Allocate each order's
         -- refunds to merchandise first and never subtract above total_amount.
         SELECT GREATEST(LEAST(amount, total_amount - COALESCE(SUM(amount) OVER (
                  PARTITION BY order_id ORDER BY occurred_at, event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ),0)),0) AS amount,
                location_id, occurred_at
           FROM raw_refund_events
       )
       SELECT COALESCE(SUM(amount),0) AS refund_total
         FROM refund_events
        WHERE ($4::uuid IS NULL OR location_id=$4::uuid)
          AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    query(
      `SELECT d::date AS day,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($2)), 0) AS revenue,
              COUNT(o.id) FILTER (WHERE o.status = ANY($2))::int AS orders
         FROM generate_series($3::date, $4::date, interval '1 day') d
         LEFT JOIN bms_orders o
           ON o.tenant_id = $1
          AND ($5::uuid IS NULL OR o.location_id=$5::uuid)
          AND COALESCE(o.paid_at, o.created_at) >= (d::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND COALESCE(o.paid_at, o.created_at) < ((d + interval '1 day')::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY day ORDER BY day`,
      [tenantId, FINANCIAL_ORDER_STATUSES, r.from, r.to, locationId || null]
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
         FROM bms_orders
        WHERE tenant_id = $1
          AND ($5::uuid IS NULL OR location_id=$5::uuid)
          AND CASE
                WHEN status='CANCELLED' THEN COALESCE(cancelled_at,updated_at,created_at)
                WHEN status='RETURNED' THEN COALESCE(returned_at,updated_at,created_at)
                WHEN status = ANY($4) THEN COALESCE(paid_at,created_at)
                ELSE created_at
              END >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND CASE
                WHEN status='CANCELLED' THEN COALESCE(cancelled_at,updated_at,created_at)
                WHEN status='RETURNED' THEN COALESCE(returned_at,updated_at,created_at)
                WHEN status = ANY($4) THEN COALESCE(paid_at,created_at)
                ELSE created_at
              END < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY status ORDER BY count DESC`,
      [tenantId, r.from, r.to, PAID, locationId || null]
    ),
    query(
      `SELECT channel,
              COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($2)), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1 AND status = ANY($2)
          AND ($5::uuid IS NULL OR location_id=$5::uuid)
          AND COALESCE(paid_at, created_at) >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND COALESCE(paid_at, created_at) < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY channel ORDER BY revenue DESC`,
      [tenantId, FINANCIAL_ORDER_STATUSES, r.from, r.to, locationId || null]
    ),
  ]);

  const revenue = Number(totals.rows[0].revenue);
  const refundTotal = Number(refunds.rows[0].refund_total);
  const orders = Number(totals.rows[0].orders);
  const toISO = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  return {
    from: r.from,
    to: r.to,
    revenue,
    refundTotal,
    netRevenue: revenue - refundTotal,
    orderCount: orders,
    avgOrderValue: orders > 0 ? revenue / orders : 0,
    byDay: byDay.rows.map((x: any) => ({ day: toISO(x.day), revenue: Number(x.revenue), orders: x.orders })),
    byStatus: byStatus.rows.map((x: any) => ({ status: x.status, count: x.count })),
    byChannel: byChannel.rows.map((x: any) => ({ channel: x.channel, revenue: Number(x.revenue), orders: x.orders })),
  };
}

/**
 * Lifetime aggregate for the staff AI surface. This intentionally omits a
 * per-day series: generating one row for every day since the shop opened can
 * make an all-time tool response unnecessarily large.
 */
export async function getLifetimeSalesSummary(tenantId: string) {
  const [totals, byStatus, byChannel] = await Promise.all([
    query(
      `SELECT MIN((COALESCE(paid_at,created_at) AT TIME ZONE 'Asia/Bangkok')::date) AS first_order_date,
              MAX((COALESCE(paid_at,created_at) AT TIME ZONE 'Asia/Bangkok')::date) AS last_order_date,
              COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($2)), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1`,
      [tenantId, PAID]
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
         FROM bms_orders
        WHERE tenant_id = $1
        GROUP BY status ORDER BY count DESC`,
      [tenantId]
    ),
    query(
      `SELECT channel,
              COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($2)), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1
        GROUP BY channel ORDER BY revenue DESC`,
      [tenantId, PAID]
    ),
  ]);

  const row = totals.rows[0];
  const revenue = Number(row.revenue);
  const orders = Number(row.orders);
  const toISO = (value: unknown) => value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value == null
      ? null
      : String(value).slice(0, 10);

  return {
    scope: "all_time" as const,
    from: toISO(row.first_order_date),
    to: toISO(row.last_order_date),
    revenue,
    orderCount: orders,
    avgOrderValue: orders > 0 ? revenue / orders : 0,
    byStatus: byStatus.rows.map((x: any) => ({ status: x.status, count: x.count })),
    byChannel: byChannel.rows.map((x: any) => ({ channel: x.channel, revenue: Number(x.revenue), orders: x.orders })),
  };
}

export async function getInventorySummary(tenantId: string, locationId?: string | null) {
  const res = await query(
    `SELECT
        COUNT(DISTINCT p.sku) FILTER (WHERE p.active)::int AS sku_count,
        COUNT(i.*)::int AS variant_count,
        COALESCE(SUM(i.current_stock), 0)::int AS total_units,
        COALESCE(SUM(i.reserved_stock), 0)::int AS reserved_units,
        COALESCE(SUM(i.current_stock - i.reserved_stock), 0)::int AS available_units,
        COALESCE(SUM(i.current_stock * COALESCE(sized.price, shared.price, p.price)), 0) AS stock_retail_value,
        COALESCE(SUM(i.current_stock * p.cost_price) FILTER (WHERE p.cost_price IS NOT NULL), 0) AS known_stock_cost_value,
        COUNT(*) FILTER (WHERE p.active AND i.current_stock > 0 AND p.cost_price IS NULL)::int AS missing_cost_variant_count,
        COUNT(*) FILTER (WHERE p.active AND (i.current_stock - i.reserved_stock) <= i.reorder_point)::int AS low_stock_count,
        COUNT(*) FILTER (WHERE p.active AND i.current_stock = 0)::int AS out_of_stock_count
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
       LEFT JOIN bms_product_packs sized
         ON sized.tenant_id = i.tenant_id AND sized.product_sku = i.product_sku
        AND sized.size = i.size AND sized.is_base AND sized.active
       LEFT JOIN bms_product_packs shared
         ON shared.tenant_id = i.tenant_id AND shared.product_sku = i.product_sku
        AND shared.size IS NULL AND shared.is_base AND shared.active
      WHERE i.tenant_id = $1
        AND ($2::uuid IS NULL OR i.location_id=$2::uuid)`,
    [tenantId, locationId || null]
  );
  const s = res.rows[0];
  return {
    skuCount: s.sku_count,
    variantCount: s.variant_count,
    totalUnits: s.total_units,
    reservedUnits: s.reserved_units,
    availableUnits: s.available_units,
    // Backward-compatible field: historically this meant retail value, not accounting cost.
    stockValue: Number(s.stock_retail_value),
    stockRetailValue: Number(s.stock_retail_value),
    stockCostValue: Number(s.missing_cost_variant_count) === 0 ? Number(s.known_stock_cost_value) : null,
    knownStockCostValue: Number(s.known_stock_cost_value),
    missingCostVariantCount: Number(s.missing_cost_variant_count),
    lowStockCount: s.low_stock_count,
    outOfStockCount: s.out_of_stock_count,
  };
}

export async function getTopSellingProducts(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  limit = 10,
  locationId?: string | null
) {
  const r = range(from, to);
  const lim = Math.min(Math.max(limit, 1), 100);
  const res = await query(
    `SELECT oi.product_sku AS sku, p.name,
            SUM(oi.qty)::int AS qty,
            SUM(oi.qty * oi.unit_price) AS revenue
       FROM bms_order_items oi
       JOIN bms_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
       JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND o.status = ANY($2)
        AND ($6::uuid IS NULL OR o.location_id=$6::uuid)
        AND COALESCE(o.paid_at,o.created_at) >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND COALESCE(o.paid_at,o.created_at) < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
      GROUP BY oi.product_sku, p.name
      ORDER BY qty DESC
      LIMIT $5`,
    [tenantId, PAID, r.from, r.to, lim, locationId || null]
  );
  return res.rows.map((x: any) => ({ sku: x.sku, name: x.name, qty: x.qty, revenue: Number(x.revenue) }));
}

/** All-time product ranking without falling through to range()'s 30-day default. */
export async function getLifetimeTopSellingProducts(tenantId: string, limit = 10) {
  const lim = Math.min(Math.max(limit, 1), 100);
  const res = await query(
    `SELECT oi.product_sku AS sku, p.name,
            SUM(oi.qty)::int AS qty,
            SUM(oi.qty * oi.unit_price) AS revenue
       FROM bms_order_items oi
       JOIN bms_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
       JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND o.status = ANY($2)
      GROUP BY oi.product_sku, p.name
      ORDER BY qty DESC
      LIMIT $3`,
    [tenantId, PAID, lim]
  );
  return res.rows.map((x: any) => ({ sku: x.sku, name: x.name, qty: x.qty, revenue: Number(x.revenue) }));
}

/** Gross profit from immutable sale-time cost evidence (9.97).
 * Legacy rows are visible as reconstructed, never silently promoted to authoritative history.
 */
export async function getProfitSummary(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  locationId?: string | null
) {
  const r = range(from, to);
  const [totals, salesByDay, refundsByDay, returnedCostsByDay] = await Promise.all([
    query(
      `WITH eligible_orders AS (
         SELECT id, total_amount
           FROM bms_orders
          WHERE tenant_id=$1 AND status=ANY($2)
            AND ($5::uuid IS NULL OR location_id=$5::uuid)
            AND COALESCE(paid_at,created_at) >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(paid_at,created_at) < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
       )
       SELECT COALESCE((SELECT SUM(total_amount) FROM eligible_orders), 0) AS revenue,
              COALESCE(SUM(oi.cost_amount_snapshot) FILTER (WHERE oi.cost_amount_snapshot IS NOT NULL), 0) AS known_cost,
              COUNT(oi.id) FILTER (WHERE oi.cost_amount_snapshot IS NULL)::int AS missing_cost_line_count,
              COUNT(DISTINCT oi.product_sku) FILTER (WHERE oi.cost_amount_snapshot IS NULL)::int AS missing_cost_sku_count,
              COALESCE(ARRAY_AGG(DISTINCT oi.product_sku) FILTER (
                WHERE oi.id IS NOT NULL AND oi.cost_amount_snapshot IS NULL
              ), ARRAY[]::text[]) AS missing_cost_skus,
              COALESCE(SUM(oi.qty * oi.unit_price) FILTER (WHERE oi.cost_amount_snapshot IS NULL), 0) AS missing_cost_revenue,
              COUNT(oi.id) FILTER (WHERE oi.cost_snapshot_source='LEGACY_CURRENT')::int AS legacy_cost_line_count
         FROM eligible_orders o
         LEFT JOIN bms_order_items oi ON oi.tenant_id=$1 AND oi.order_id=o.id`,
      [tenantId, FINANCIAL_ORDER_STATUSES, r.from, r.to, locationId || null]
    ),
    query(
      `WITH eligible_orders AS (
         SELECT id, total_amount,
                (COALESCE(paid_at,created_at) AT TIME ZONE 'Asia/Bangkok')::date AS day
           FROM bms_orders
          WHERE tenant_id=$1 AND status=ANY($2)
            AND ($5::uuid IS NULL OR location_id=$5::uuid)
            AND COALESCE(paid_at,created_at) >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(paid_at,created_at) < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
       ), order_cost AS (
         SELECT o.id, o.day, o.total_amount,
                COALESCE(SUM(oi.cost_amount_snapshot) FILTER (WHERE oi.cost_amount_snapshot IS NOT NULL),0) AS known_cost,
                COUNT(oi.id) FILTER (WHERE oi.cost_amount_snapshot IS NULL)::int AS missing_cost_line_count
           FROM eligible_orders o
           LEFT JOIN bms_order_items oi ON oi.tenant_id=$1 AND oi.order_id=o.id
          GROUP BY o.id, o.day, o.total_amount
       )
       SELECT day, COALESCE(SUM(total_amount),0) AS revenue,
              COALESCE(SUM(known_cost),0) AS known_cost,
              COALESCE(SUM(missing_cost_line_count),0)::int AS missing_cost_line_count
         FROM order_cost GROUP BY day ORDER BY day`,
      [tenantId, FINANCIAL_ORDER_STATUSES, r.from, r.to, locationId || null]
    ),
    query(
      `WITH raw_refund_events AS (
         SELECT pr.order_id, 'pos:' || a.id::text AS event_id, a.amount,
                o.total_amount, pr.return_location_id AS location_id,
                COALESCE(a.completed_at, a.updated_at) AS occurred_at
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE a.tenant_id=$1 AND a.status='COMPLETED'
         UNION ALL
         SELECT p.order_id, 'payment:' || p.id::text AS event_id, p.amount,
                o.total_amount, o.location_id,
                COALESCE(p.refunded_at,p.updated_at) AS occurred_at
           FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='REFUNDED'
            AND NOT EXISTS (
              SELECT 1 FROM bms_pos_refund_allocations a
               WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id
            )
       ), refund_events AS (
         SELECT GREATEST(LEAST(amount, total_amount - COALESCE(SUM(amount) OVER (
                  PARTITION BY order_id ORDER BY occurred_at, event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ),0)),0) AS amount,
                location_id, occurred_at
           FROM raw_refund_events
       )
       SELECT (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
              COALESCE(SUM(amount),0) AS refund_total
         FROM refund_events
        WHERE ($4::uuid IS NULL OR location_id=$4::uuid)
          AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY day ORDER BY day`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    query(
      `WITH settled_pos_returns AS (
         SELECT pr.id, pr.tenant_id, pr.return_location_id,
                COALESCE(MAX(a.completed_at), pr.updated_at) AS occurred_at
           FROM bms_pos_returns pr
           LEFT JOIN bms_pos_refund_allocations a
             ON a.tenant_id=pr.tenant_id AND a.pos_return_id=pr.id
          WHERE pr.tenant_id=$1 AND pr.settlement_status='COMPLETED'
          GROUP BY pr.id, pr.tenant_id, pr.return_location_id, pr.updated_at
       ), returned_lines AS (
         -- POS can return part of a line, possibly at another branch. Reverse
         -- only the returned fraction once its refund settlement is complete.
         SELECT pr.occurred_at, pr.return_location_id AS location_id,
                oi.product_sku, oi.cost_amount_snapshot,
                oi.cost_amount_snapshot * pri.qty::numeric / NULLIF(oi.qty,0) AS returned_cost,
                pri.refund_amount AS missing_cost_revenue
           FROM settled_pos_returns pr
           JOIN bms_pos_return_items pri
             ON pri.tenant_id=pr.tenant_id AND pri.pos_return_id=pr.id
           JOIN bms_order_items oi
             ON oi.tenant_id=pri.tenant_id AND oi.id=pri.order_item_id
         UNION ALL
         -- The web/back-office flow returns a whole order and creates no
         -- bms_pos_returns row. Exclude POS-linked orders to avoid reversing a
         -- full POS return through both paths.
         SELECT COALESCE(o.returned_at,o.updated_at) AS occurred_at,
                o.location_id, oi.product_sku, oi.cost_amount_snapshot,
                oi.cost_amount_snapshot AS returned_cost,
                oi.qty * oi.unit_price AS missing_cost_revenue
           FROM bms_orders o
           JOIN bms_order_items oi
             ON oi.tenant_id=o.tenant_id AND oi.order_id=o.id
          WHERE o.tenant_id=$1 AND o.status='RETURNED'
            AND NOT EXISTS (
              SELECT 1 FROM bms_pos_returns pr
               WHERE pr.tenant_id=o.tenant_id AND pr.order_id=o.id
            )
       )
       SELECT (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
              COALESCE(SUM(returned_cost) FILTER (WHERE cost_amount_snapshot IS NOT NULL),0) AS returned_known_cost,
              COUNT(*) FILTER (WHERE cost_amount_snapshot IS NULL)::int AS missing_cost_line_count,
              COUNT(DISTINCT product_sku) FILTER (WHERE cost_amount_snapshot IS NULL)::int AS missing_cost_sku_count,
              COALESCE(ARRAY_AGG(DISTINCT product_sku) FILTER (WHERE cost_amount_snapshot IS NULL), ARRAY[]::text[]) AS missing_cost_skus,
              COALESCE(SUM(missing_cost_revenue) FILTER (WHERE cost_amount_snapshot IS NULL),0) AS missing_cost_revenue
         FROM returned_lines
        WHERE ($4::uuid IS NULL OR location_id=$4::uuid)
          AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY day ORDER BY day`,
      [tenantId, r.from, r.to, locationId || null]
    ),
  ]);

  const refundTotal = refundsByDay.rows.reduce(
    (sum: number, row: any) => sum + Number(row.refund_total),
    0
  );
  const returnedKnownCost = returnedCostsByDay.rows.reduce(
    (sum: number, row: any) => sum + Number(row.returned_known_cost),
    0
  );
  const revenue = Number(totals.rows[0].revenue) - refundTotal;
  const knownCost = Number(totals.rows[0].known_cost) - returnedKnownCost;
  const missingCostLineCount = Number(totals.rows[0].missing_cost_line_count)
    + returnedCostsByDay.rows.reduce(
      (sum: number, row: any) => sum + Number(row.missing_cost_line_count),
      0
    );
  const missingCostSkus = new Set<string>(
    (totals.rows[0].missing_cost_skus ?? []).map(String)
  );
  for (const row of returnedCostsByDay.rows) {
    for (const sku of row.missing_cost_skus ?? []) missingCostSkus.add(String(sku));
  }
  const missingCostSkuCount = missingCostSkus.size;
  const missingCostRevenue = Number(totals.rows[0].missing_cost_revenue)
    + returnedCostsByDay.rows.reduce(
      (sum: number, row: any) => sum + Number(row.missing_cost_revenue),
      0
    );
  const legacyCostLineCount = Number(totals.rows[0].legacy_cost_line_count);
  const complete = missingCostLineCount === 0;
  const authoritative = complete && legacyCostLineCount === 0;
  const profit = complete ? revenue - knownCost : null;
  const toISO = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  return {
    method: authoritative ? "sale_time_snapshot" as const : "mixed_evidence" as const,
    disclaimer: complete
      ? legacyCostLineCount > 0
        ? `รายได้หัก refund ที่ชำระแล้ว (ไม่รวมค่าส่ง); ต้นทุนหักสินค้าคืน POS ที่ settlement ครบและออเดอร์เว็บ/หลังบ้านที่คืนแล้ว แต่มี ${legacyCostLineCount} บรรทัดย้อนหลังที่ reconstruct จากต้นทุนปัจจุบันตอน migration`
        : "รายได้หัก refund ที่ชำระแล้ว (ไม่รวมค่าส่ง) และต้นทุนหักสินค้าคืน POS ที่ settlement ครบ/ออเดอร์เว็บหรือหลังบ้านที่คืนแล้ว จาก snapshot ณ เวลาขาย"
      : `รายได้ใช้ออเดอร์สุทธิหลังส่วนลด แต่ยังคำนวณกำไรรวมไม่ได้ เพราะมี ${missingCostSkuCount} SKU ที่ไม่มีต้นทุน (${missingCostLineCount} บรรทัดขาย) — ห้ามตีต้นทุนที่หายเป็นศูนย์`,
    from: r.from,
    to: r.to,
    revenue,
    cost: complete ? knownCost : null,
    knownCost,
    profit,
    marginPct: complete && revenue > 0 && profit !== null ? (profit / revenue) * 100 : null,
    complete,
    authoritative,
    legacyCostLineCount,
    missingCostLineCount,
    missingCostSkuCount,
    missingCostRevenue,
    byDay: (() => {
      const days = new Map<string, {
        revenue: number;
        knownCost: number;
        missingCostLineCount: number;
      }>();
      const at = (dayValue: any) => {
        const day = toISO(dayValue);
        const current = days.get(day) ?? {
          revenue: 0,
          knownCost: 0,
          missingCostLineCount: 0,
        };
        days.set(day, current);
        return current;
      };
      for (const row of salesByDay.rows) {
        const day = at(row.day);
        day.revenue += Number(row.revenue);
        day.knownCost += Number(row.known_cost);
        day.missingCostLineCount += Number(row.missing_cost_line_count);
      }
      for (const row of refundsByDay.rows) {
        at(row.day).revenue -= Number(row.refund_total);
      }
      for (const row of returnedCostsByDay.rows) {
        const day = at(row.day);
        day.knownCost -= Number(row.returned_known_cost);
        day.missingCostLineCount += Number(row.missing_cost_line_count);
      }
      return [...days.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, value]) => ({
          day,
          revenue: value.revenue,
          cost: value.missingCostLineCount === 0 ? value.knownCost : null,
          knownCost: value.knownCost,
          profit: value.missingCostLineCount === 0
            ? value.revenue - value.knownCost
            : null,
          missingCostLineCount: value.missingCostLineCount,
        }));
    })(),
  };
}

export async function getPosReturnSummary(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  locationId?: string | null
) {
  const r = range(from, to);
  const [totals, reasons, recent] = await Promise.all([
    query(
      `WITH selected_returns AS (
         SELECT pr.id, pr.refund_amount
           FROM bms_pos_returns pr
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE pr.tenant_id = $1
            AND pr.is_void = FALSE
            AND ($4::uuid IS NULL OR COALESCE(pr.return_location_id,o.location_id)=$4::uuid)
            AND pr.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND pr.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
       )
       SELECT COUNT(*)::int AS return_count,
              COALESCE(SUM(refund_amount), 0) AS refund_total,
              COALESCE((
                SELECT SUM(a.amount)
                  FROM bms_pos_refund_allocations a
                  JOIN selected_returns sr ON sr.id = a.pos_return_id
                 WHERE a.tenant_id = $1 AND a.status = 'COMPLETED'
              ), 0) AS settled_total,
              COALESCE((
                SELECT SUM(a.amount)
                  FROM bms_pos_refund_allocations a
                  JOIN selected_returns sr ON sr.id = a.pos_return_id
                 WHERE a.tenant_id = $1 AND a.status = 'PENDING'
              ), 0) AS pending_total,
              (SELECT COUNT(*)::int
                 FROM bms_pos_refund_allocations a
                 JOIN selected_returns sr ON sr.id = a.pos_return_id
                WHERE a.tenant_id = $1 AND a.status = 'PENDING') AS pending_count
         FROM selected_returns`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    query(
      `SELECT COALESCE(NULLIF(trim(note), ''), '(no reason)') AS note,
              COUNT(*)::int AS count
         FROM bms_pos_returns pr
         JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
        WHERE pr.tenant_id = $1
          AND pr.is_void = FALSE
          AND ($4::uuid IS NULL OR COALESCE(pr.return_location_id,o.location_id)=$4::uuid)
          AND pr.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND pr.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY 1
        ORDER BY count DESC, note
        LIMIT 5`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    query(
      `SELECT pr.id,
              pr.order_id,
              pr.refund_amount,
              pr.return_mode,
              pr.settlement_status,
              pr.source_channel,
              pr.cross_branch,
              pr.note,
              pr.created_at,
              sale_location.name AS sale_location_name,
              return_location.name AS return_location_name,
              COALESCE(u.name, u.email, pr.returned_by::text) AS returned_by,
              COALESCE((SELECT SUM(a.amount) FROM bms_pos_refund_allocations a
                         WHERE a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
                           AND a.status = 'COMPLETED'), 0) AS settled_amount,
              COALESCE((SELECT SUM(a.amount) FROM bms_pos_refund_allocations a
                         WHERE a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
                           AND a.status = 'PENDING'), 0) AS pending_amount
         FROM bms_pos_returns pr
         LEFT JOIN users u ON u.id = pr.returned_by
         LEFT JOIN bms_orders source_order
           ON source_order.tenant_id = pr.tenant_id AND source_order.id = pr.order_id
         LEFT JOIN bms_locations sale_location
           ON sale_location.tenant_id = pr.tenant_id
          AND sale_location.id = COALESCE(pr.sale_location_id, source_order.location_id)
         LEFT JOIN bms_locations return_location
           ON return_location.tenant_id = pr.tenant_id
          AND return_location.id = pr.return_location_id
        WHERE pr.tenant_id = $1
          AND pr.is_void = FALSE
          AND ($4::uuid IS NULL OR COALESCE(pr.return_location_id,source_order.location_id)=$4::uuid)
          AND pr.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND pr.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        ORDER BY pr.created_at DESC
        LIMIT 10`,
      [tenantId, r.from, r.to, locationId || null]
    ),
  ]);

  return {
    from: r.from,
    to: r.to,
    returnCount: Number(totals.rows[0]?.return_count ?? 0),
    refundTotal: Number(totals.rows[0]?.refund_total ?? 0),
    settledTotal: Number(totals.rows[0]?.settled_total ?? 0),
    pendingTotal: Number(totals.rows[0]?.pending_total ?? 0),
    pendingCount: Number(totals.rows[0]?.pending_count ?? 0),
    topReasons: reasons.rows.map((row: any) => {
      const parsed = parseReturnReason(row.note);
      return {
        reasonCode: parsed.reasonCode,
        reasonText: parsed.reasonText,
        count: Number(row.count ?? 0),
      };
    }),
    recent: recent.rows.map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      refundAmount: Number(row.refund_amount ?? 0),
      returnMode: row.return_mode ?? "FULL",
      sourceChannel: row.source_channel ?? "pos",
      crossBranch: Boolean(row.cross_branch),
      saleLocationName: row.sale_location_name ?? null,
      returnLocationName: row.return_location_name ?? null,
      settlementStatus: row.settlement_status ?? "PENDING",
      settledAmount: Number(row.settled_amount ?? 0),
      pendingAmount: Number(row.pending_amount ?? 0),
      note: row.note ?? null,
      ...parseReturnReason(row.note),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      returnedBy: row.returned_by ?? null,
    })),
  };
}

export async function getPosReturnAuditSummary(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  locationId?: string | null
) {
  const r = range(from, to);
  const [byCashier, approvals, blind] = await Promise.all([
    query(
      `SELECT COALESCE(u.name, u.email, pr.returned_by::text, 'unknown') AS cashier,
              COUNT(*)::int AS return_count,
              COALESCE(SUM(pr.refund_amount), 0) AS refund_total
         FROM bms_pos_returns pr
         LEFT JOIN users u ON u.id = pr.returned_by
         JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
        WHERE pr.tenant_id = $1
          AND pr.is_void = FALSE
          AND ($4::uuid IS NULL OR COALESCE(pr.return_location_id,o.location_id)=$4::uuid)
          AND pr.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND pr.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY 1
        ORDER BY refund_total DESC, return_count DESC
        LIMIT 10`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    query(
      `SELECT
          COUNT(*) FILTER (WHERE refund_amount >= 500)::int AS approval_candidate_count,
          COUNT(*) FILTER (WHERE refund_amount >= 2000)::int AS high_value_return_count,
          COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int AS approved_count,
          COUNT(*) FILTER (WHERE refund_amount >= 500 AND approved_by IS NULL)::int AS missing_approval_count
         FROM bms_pos_returns pr
         JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
        WHERE pr.tenant_id = $1
          AND pr.is_void = FALSE
          AND ($4::uuid IS NULL OR COALESCE(pr.return_location_id,o.location_id)=$4::uuid)
          AND pr.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND pr.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      [tenantId, r.from, r.to, locationId || null]
    ),
    // คืนโดยไม่มีใบเสร็จ (8.2) — นับแยกจากการคืนปกติเสมอ
    // เป็นการจ่ายเงินออกโดยเชื่อคำบอกเล่า ไม่ใช่การคืนที่ตรวจย้อนกับบิลได้
    // ถ้ารวมเข้ากับตัวเลขเดียวกัน สัญญาณที่ควรดังที่สุดจะถูกกลบด้วยการคืนปกติ
    query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(refund_amount), 0) AS refund_total,
              COUNT(DISTINCT returned_by)::int AS staff_count
        FROM bms_pos_blind_returns
        WHERE tenant_id = $1
          AND ($4::uuid IS NULL OR location_id=$4::uuid)
          AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      [tenantId, r.from, r.to, locationId || null]
    ),
  ]);

  const blindCount = Number(blind.rows[0]?.count ?? 0);
  const blindTotal = Number(blind.rows[0]?.refund_total ?? 0);
  const anomalyCodes = [
    Number(approvals.rows[0]?.missing_approval_count ?? 0) > 0 ? "MISSING_APPROVAL" : null,
    Number(approvals.rows[0]?.high_value_return_count ?? 0) > 0 ? "HIGH_VALUE_RETURN" : null,
    byCashier.rows.some((row: any) => Number(row.return_count ?? 0) >= 5) ? "FREQUENT_CASHIER_RETURNS" : null,
    byCashier.rows.some((row: any) => Number(row.refund_total ?? 0) >= 5000) ? "HIGH_CASHIER_REFUND_TOTAL" : null,
    blindCount > 0 ? "NO_RECEIPT_RETURN" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    from: r.from,
    to: r.to,
    noReceiptCount: blindCount,
    noReceiptTotal: blindTotal,
    byCashier: byCashier.rows.map((row: any) => ({
      cashier: String(row.cashier ?? "unknown"),
      returnCount: Number(row.return_count ?? 0),
      refundTotal: Number(row.refund_total ?? 0),
    })),
    approvalCandidateCount: Number(approvals.rows[0]?.approval_candidate_count ?? 0),
    highValueReturnCount: Number(approvals.rows[0]?.high_value_return_count ?? 0),
    approvedCount: Number(approvals.rows[0]?.approved_count ?? 0),
    missingApprovalCount: Number(approvals.rows[0]?.missing_approval_count ?? 0),
    anomalyCodes,
    anomalySignals: [
      Number(approvals.rows[0]?.missing_approval_count ?? 0) > 0
        ? "พบรายการตั้งแต่ ฿500 ที่ไม่มีผู้อนุมัติในข้อมูลย้อนหลัง — ควรตรวจรายการก่อนเริ่มใช้กฎใหม่"
        : null,
      Number(approvals.rows[0]?.high_value_return_count ?? 0) > 0
        ? "มี high-value return ในช่วงเวลานี้"
        : null,
      byCashier.rows.some((row: any) => Number(row.return_count ?? 0) >= 5)
        ? "มี cashier ที่คืนสินค้าถี่ผิดปกติ (>= 5 ครั้งในช่วงที่เลือก)"
        : null,
      byCashier.rows.some((row: any) => Number(row.refund_total ?? 0) >= 5000)
        ? "มี cashier ที่ยอดคืนรวมสูงผิดปกติ (>= ฿5,000 ในช่วงที่เลือก)"
        : null,
      blindCount > 0
        ? `มีการคืนโดยไม่มีใบเสร็จ ${blindCount} รายการ รวม ฿${blindTotal.toLocaleString("th-TH")} — ตรวจทุกรายการ`
        : null,
    ].filter(Boolean),
  };
}

type ReportBucket = { key: string; count: number; amount: number };

function reportBuckets(rows: any[]): ReportBucket[] {
  return rows.map((row: any) => ({
    key: String(row.key ?? "UNKNOWN"),
    count: Number(row.count ?? 0),
    amount: Number(row.amount ?? 0),
  }));
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

type ReportGroup = "RETAIL" | "FOOD_SERVICE" | "WHOLESALE" | "PHARMACY" | "BOARD_GAME_CAFE";

function reportGroupForArchetype(archetype: ShopArchetype | null): ReportGroup {
  if (archetype === "restaurant") return "FOOD_SERVICE";
  if (archetype === "board_game_cafe") return "BOARD_GAME_CAFE";
  if (archetype === "pharmacy") return "PHARMACY";
  if (archetype === "b2b_wholesale" || archetype === "building_materials") return "WHOLESALE";
  return "RETAIL";
}

/**
 * Report modules are presentation hints, never authorization. The server-derived archetype decides
 * which specialist facts are queried and returned; the UI only uses these keys to order the cards.
 */
function reportModulesForArchetype(archetype: ShopArchetype | null): string[] {
  const modules = ["CORE", "SALES", "PROFIT", "PAYMENTS", "CUSTOMERS", "INVENTORY"];
  switch (archetype) {
    case "restaurant": return [...modules, "RESTAURANT", "KITCHEN", "QR_ORDERING", "WASTAGE"];
    case "board_game_cafe": return [...modules, "BOARD_GAME_SESSIONS", "GAME_LIBRARY", "MEMBER_PASSES"];
    case "pharmacy": return [...modules, "PHARMACY_COMPLIANCE", "LOTS_EXPIRY", "PACKS"];
    case "mini_mart": return [...modules, "LOTS_EXPIRY", "PACKS", "WASTAGE"];
    case "fashion": return [...modules, "VARIANTS", "RETURNS"];
    case "food_beverage": return [...modules, "LOTS_EXPIRY", "WASTAGE", "PACKS"];
    case "gadgets_accessories": return [...modules, "SERIALS", "VARIANTS", "RETURNS"];
    case "beauty_personal_care": return [...modules, "LOTS_EXPIRY", "VARIANTS"];
    case "b2b_wholesale": return [...modules, "PACKS", "ACCOUNTS_RECEIVABLE", "PURCHASING"];
    case "building_materials": return [...modules, "PACKS", "ACCOUNTS_RECEIVABLE", "SERIALS"];
    case "home_kitchen": return [...modules, "VARIANTS", "PACKS", "SERIALS"];
    case "pet_supply": return [...modules, "LOTS_EXPIRY", "PACKS"];
    case "gifts_seasonal": return [...modules, "VARIANTS"];
    default: return [...modules, "VARIANTS", "PACKS"];
  }
}

async function getArchetypeReport(
  tenantId: string,
  from: string,
  to: string,
  locationId: string | null
) {
  const profile = await query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id=$1 LIMIT 1`,
    [tenantId]
  );
  const archetype = normalizeShopArchetype(profile.rows[0]?.business_archetype);
  const params = [tenantId, from, to, locationId];

  const [variants, packs, lots, serials] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE v.active)::int AS active_variants,
              COUNT(DISTINCT v.product_sku) FILTER (WHERE v.active)::int AS products_with_variants,
              COUNT(DISTINCT v.product_sku) FILTER (WHERE v.active AND multi.variant_count > 1)::int AS multi_variant_products
         FROM bms_product_variants v
         LEFT JOIN (
           SELECT tenant_id, product_sku, COUNT(*) FILTER (WHERE active)::int AS variant_count
             FROM bms_product_variants WHERE tenant_id=$1 GROUP BY tenant_id, product_sku
         ) multi ON multi.tenant_id=v.tenant_id AND multi.product_sku=v.product_sku
        WHERE v.tenant_id=$1`,
      [tenantId]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE active)::int AS active_packs,
              COUNT(DISTINCT product_sku) FILTER (WHERE active)::int AS products_with_packs,
              COUNT(*) FILTER (WHERE active AND NOT is_base)::int AS alternate_packs
         FROM bms_product_packs WHERE tenant_id=$1`,
      [tenantId]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE qty > 0)::int AS stocked_lots,
              COALESCE(SUM(qty) FILTER (WHERE qty > 0),0)::int AS lot_units,
              COUNT(*) FILTER (WHERE qty > 0 AND expiry_date < CURRENT_DATE)::int AS expired_lots,
              COALESCE(SUM(qty) FILTER (WHERE qty > 0 AND expiry_date < CURRENT_DATE),0)::int AS expired_units,
              COUNT(*) FILTER (WHERE qty > 0 AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expiring_lots,
              COALESCE(SUM(qty) FILTER (WHERE qty > 0 AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),0)::int AS expiring_units,
              COUNT(*) FILTER (WHERE qty > 0 AND expiry_date IS NULL)::int AS lots_missing_expiry
         FROM bms_inventory_lots
        WHERE tenant_id=$1 AND ($2::uuid IS NULL OR location_id=$2::uuid)`,
      [tenantId, locationId]
    ),
    query(
      `SELECT COUNT(DISTINCT p.sku) FILTER (WHERE p.serial_tracked)::int AS tracked_skus,
              COUNT(s.id) FILTER (WHERE s.status='IN_STOCK')::int AS in_stock,
              COUNT(s.id) FILTER (WHERE s.status='SOLD')::int AS sold,
              COUNT(s.id) FILTER (WHERE s.status='RETURNED')::int AS returned
         FROM bms_products p
         LEFT JOIN bms_product_serials s
           ON s.tenant_id=p.tenant_id AND s.product_sku=p.sku
          AND ($2::uuid IS NULL OR s.location_id=$2::uuid)
        WHERE p.tenant_id=$1`,
      [tenantId, locationId]
    ),
  ]);

  const variantRow = variants.rows[0] ?? {};
  const packRow = packs.rows[0] ?? {};
  const lotRow = lots.rows[0] ?? {};
  const serialRow = serials.rows[0] ?? {};
  const catalog = {
    activeVariantCount: Number(variantRow.active_variants ?? 0),
    productsWithVariants: Number(variantRow.products_with_variants ?? 0),
    multiVariantProductCount: Number(variantRow.multi_variant_products ?? 0),
    activePackCount: Number(packRow.active_packs ?? 0),
    productsWithPacks: Number(packRow.products_with_packs ?? 0),
    alternatePackCount: Number(packRow.alternate_packs ?? 0),
    stockedLotCount: Number(lotRow.stocked_lots ?? 0),
    lotUnits: Number(lotRow.lot_units ?? 0),
    expiredLotCount: Number(lotRow.expired_lots ?? 0),
    expiredUnits: Number(lotRow.expired_units ?? 0),
    expiringLotCount: Number(lotRow.expiring_lots ?? 0),
    expiringUnits: Number(lotRow.expiring_units ?? 0),
    lotsMissingExpiry: Number(lotRow.lots_missing_expiry ?? 0),
    serialTrackedSkuCount: Number(serialRow.tracked_skus ?? 0),
    serialInStockCount: Number(serialRow.in_stock ?? 0),
    serialSoldCount: Number(serialRow.sold ?? 0),
    serialReturnedCount: Number(serialRow.returned ?? 0),
  };

  let restaurant = null;
  if (archetype === "restaurant") {
    const [checks, tickets, qr] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS checks,
                COUNT(*) FILTER (WHERE status='PAID')::int AS paid_checks,
                COUNT(*) FILTER (WHERE status='CANCELLED')::int AS cancelled_checks,
                COALESCE(SUM(guest_count),0)::int AS guests,
                COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at-opened_at))/60)
                  FILTER (WHERE status='PAID'),0) AS avg_table_minutes
           FROM bms_restaurant_checks
          WHERE tenant_id=$1 AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND opened_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND opened_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
        params
      ),
      query(
        `SELECT COUNT(*)::int AS tickets,
                COUNT(*) FILTER (WHERE k.status='SERVED')::int AS served,
                COUNT(*) FILTER (WHERE k.status='CANCELLED')::int AS cancelled,
                COALESCE(AVG(EXTRACT(EPOCH FROM (k.updated_at-k.created_at))/60)
                  FILTER (WHERE k.status='SERVED'),0) AS avg_kitchen_minutes
           FROM bms_restaurant_kitchen_tickets k
           JOIN bms_restaurant_checks c ON c.tenant_id=k.tenant_id AND c.id=k.check_id
          WHERE k.tenant_id=$1 AND ($4::uuid IS NULL OR c.location_id=$4::uuid)
            AND k.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND k.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
        params
      ),
      query(
        `SELECT COUNT(*)::int AS submissions,
                COUNT(*) FILTER (WHERE status='ACCEPTED')::int AS accepted,
                COUNT(*) FILTER (WHERE status='REJECTED')::int AS rejected
           FROM bms_restaurant_qr_submissions
          WHERE tenant_id=$1 AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND submitted_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND submitted_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
        params
      ),
    ]);
    const c = checks.rows[0] ?? {};
    const k = tickets.rows[0] ?? {};
    const q = qr.rows[0] ?? {};
    restaurant = {
      checkCount: Number(c.checks ?? 0), paidCheckCount: Number(c.paid_checks ?? 0),
      cancelledCheckCount: Number(c.cancelled_checks ?? 0), guestCount: Number(c.guests ?? 0),
      avgTableMinutes: Number(c.avg_table_minutes ?? 0), kitchenTicketCount: Number(k.tickets ?? 0),
      servedTicketCount: Number(k.served ?? 0), cancelledTicketCount: Number(k.cancelled ?? 0),
      avgKitchenMinutes: Number(k.avg_kitchen_minutes ?? 0), qrSubmissionCount: Number(q.submissions ?? 0),
      qrAcceptedCount: Number(q.accepted ?? 0), qrRejectedCount: Number(q.rejected ?? 0),
    };
  }

  let pharmacy = null;
  if (archetype === "pharmacy") {
    const policies = await query(
      `SELECT COUNT(*)::int AS policy_count,
              COUNT(*) FILTER (WHERE status='APPROVED')::int AS approved,
              COUNT(*) FILTER (WHERE status='DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status='PENDING_REVIEW')::int AS pending_review,
              COUNT(*) FILTER (WHERE status='RETIRED')::int AS retired,
              (SELECT COUNT(*)::int FROM bms_products p WHERE p.tenant_id=$1 AND p.active
                AND NOT EXISTS (SELECT 1 FROM bms_pharmacy_product_policies pp
                  WHERE pp.tenant_id=p.tenant_id AND pp.product_sku=p.sku)) AS missing_policy
         FROM bms_pharmacy_product_policies WHERE tenant_id=$1`,
      [tenantId]
    );
    const p = policies.rows[0] ?? {};
    pharmacy = {
      policyCount: Number(p.policy_count ?? 0), approvedPolicyCount: Number(p.approved ?? 0),
      draftPolicyCount: Number(p.draft ?? 0), pendingReviewPolicyCount: Number(p.pending_review ?? 0),
      retiredPolicyCount: Number(p.retired ?? 0),
      missingPolicySkuCount: Number(p.missing_policy ?? 0),
    };
  }

  let boardGame = null;
  if (archetype === "board_game_cafe") {
    const [sessions, billingGroups, library, passes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS sessions,
                COUNT(*) FILTER (WHERE status='PAID')::int AS paid_sessions,
                COUNT(*) FILTER (WHERE status='CANCELLED')::int AS cancelled_sessions,
                COALESCE(SUM(guest_count),0)::int AS guests,
                COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at-started_at))/60)
                  FILTER (WHERE status='PAID'),0) AS avg_play_minutes
           FROM bms_board_game_sessions
          WHERE tenant_id=$1 AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND started_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND started_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
        params
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE status='PAID')::int AS paid_groups,
                COUNT(*) FILTER (WHERE status IN ('OPEN','CLOSING'))::int AS open_groups,
                COALESCE(SUM(amount_due) FILTER (WHERE status='PAID'),0) AS settled_amount
           FROM bms_board_game_billing_groups
          WHERE tenant_id=$1 AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND (
              (status='PAID'
                AND ended_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                AND ended_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))
              OR status IN ('OPEN','CLOSING')
            )`,
        params
      ),
      query(
        `SELECT COUNT(DISTINCT t.id)::int AS titles,
                COUNT(c.id)::int AS copies,
                COUNT(c.id) FILTER (WHERE c.status='AVAILABLE')::int AS available,
                COUNT(c.id) FILTER (WHERE c.status IN ('NEEDS_CHECK','DAMAGED','MISSING_PARTS','REPAIRING','LOST'))::int AS attention,
                (SELECT COUNT(*)::int FROM bms_board_game_session_games g
                  JOIN bms_board_game_sessions s ON s.tenant_id=g.tenant_id AND s.id=g.session_id
                 WHERE g.tenant_id=$1 AND g.status='CHECKED_OUT'
                   AND ($2::uuid IS NULL OR s.location_id=$2::uuid)) AS checked_out
           FROM bms_board_game_titles t
           LEFT JOIN bms_board_game_copies c ON c.tenant_id=t.tenant_id AND c.title_id=t.id
            AND ($2::uuid IS NULL OR c.location_id=$2::uuid)
          WHERE t.tenant_id=$1`,
        [tenantId, locationId]
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE status='ACTIVE' AND expires_at > now())::int AS active_passes,
                COUNT(*) FILTER (WHERE status='ACTIVE' AND expires_at > now() AND remaining_minutes IS NOT NULL)::int AS minute_passes,
                COALESCE(SUM(remaining_minutes) FILTER (WHERE status='ACTIVE' AND expires_at > now()),0)::int AS remaining_minutes
           FROM bms_board_game_member_passes
          WHERE tenant_id=$1 AND ($2::uuid IS NULL OR location_id IS NULL OR location_id=$2::uuid)`,
        [tenantId, locationId]
      ),
    ]);
    const s = sessions.rows[0] ?? {};
    const g = billingGroups.rows[0] ?? {};
    const l = library.rows[0] ?? {};
    const p = passes.rows[0] ?? {};
    boardGame = {
      sessionCount: Number(s.sessions ?? 0), paidSessionCount: Number(s.paid_sessions ?? 0),
      cancelledSessionCount: Number(s.cancelled_sessions ?? 0), guestCount: Number(s.guests ?? 0),
      avgPlayMinutes: Number(s.avg_play_minutes ?? 0), paidBillingGroupCount: Number(g.paid_groups ?? 0),
      openBillingGroupCount: Number(g.open_groups ?? 0), settledAmount: Number(g.settled_amount ?? 0),
      titleCount: Number(l.titles ?? 0), copyCount: Number(l.copies ?? 0),
      availableCopyCount: Number(l.available ?? 0), attentionCopyCount: Number(l.attention ?? 0),
      checkedOutCopyCount: Number(l.checked_out ?? 0), activePassCount: Number(p.active_passes ?? 0),
      minutePassCount: Number(p.minute_passes ?? 0), remainingPassMinutes: Number(p.remaining_minutes ?? 0),
    };
  }

  return {
    profile: {
      archetype,
      group: reportGroupForArchetype(archetype),
      moduleKeys: reportModulesForArchetype(archetype),
    },
    catalog,
    restaurant,
    pharmacy,
    boardGame,
  };
}

/**
 * Management report center facts.
 *
 * This deliberately composes verified ledgers and lifecycle timestamps instead of deriving
 * business figures in the client. `locationId` is only a filter: every statement still names
 * `tenant_id`, so a location UUID from another shop can never widen the result.
 */
export async function getManagementReport(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  locationId?: string | null
) {
  const r = range(from, to);
  if (locationId && !(await getLocation(tenantId, locationId))) {
    throw new Error("ไม่พบสาขานี้ หรือสาขาไม่ได้อยู่ในร้านปัจจุบัน");
  }
  const params = [tenantId, r.from, r.to, locationId || null];
  const periodDays = Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
  const previousTo = addDateKeyDays(r.from, -1);
  const previousFrom = addDateKeyDays(previousTo, -(periodDays - 1));

  const [
    profit,
    branches,
    products,
    paymentTotals,
    paymentMethods,
    paymentStatuses,
    purchaseTotals,
    purchaseStatuses,
    suppliers,
    customers,
    shipmentTotals,
    shipmentStatuses,
    controls,
    stockMovements,
    archetypeReport,
    currentSales,
    previousSales,
    previousProfit,
    reconciliationRaw,
    inventoryAgingRaw,
    supplierPerformanceRaw,
    discountPerformanceRaw,
    customerSegmentsRaw,
    liabilities,
  ] = await Promise.all([
    getProfitSummary(tenantId, r.from, r.to, locationId),
    query(
      `SELECT l.id, l.code, l.name,
              COUNT(o.id) FILTER (WHERE o.status = ANY($5))::int AS orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($5)), 0) AS revenue
         FROM bms_locations l
         LEFT JOIN bms_orders o
           ON o.tenant_id = l.tenant_id AND o.location_id = l.id
          AND COALESCE(o.paid_at, o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND COALESCE(o.paid_at, o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        WHERE l.tenant_id = $1 AND l.active
        GROUP BY l.id, l.code, l.name
        ORDER BY revenue DESC, l.code`,
      [...params, PAID]
    ),
    query(
      `WITH sold AS (
         SELECT oi.product_sku AS sku,
                SUM(oi.qty)::int AS qty,
                SUM(oi.qty * oi.unit_price) AS revenue,
                SUM(oi.cost_amount_snapshot) FILTER (WHERE oi.cost_amount_snapshot IS NOT NULL) AS known_cost,
                COUNT(*) FILTER (WHERE oi.cost_amount_snapshot IS NULL)::int AS missing_cost_lines
           FROM bms_order_items oi
           JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
          WHERE oi.tenant_id=$1 AND o.status = ANY($5)
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
            AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          GROUP BY oi.product_sku
       )
       SELECT p.sku, p.name, p.category,
              COALESCE(s.qty,0)::int AS qty,
              COALESCE(s.revenue,0) AS revenue,
              COALESCE(s.known_cost,0) AS known_cost,
              COALESCE(s.missing_cost_lines,0)::int AS missing_cost_lines
       FROM bms_products p
         LEFT JOIN sold s ON s.sku=p.sku
        WHERE p.tenant_id=$1 AND p.active
        ORDER BY revenue DESC, qty DESC, p.sku`,
      [...params, PAID]
    ),
    query(
      `WITH refund_events AS (
         SELECT a.amount, COALESCE(a.completed_at,a.updated_at) AS occurred_at
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
          WHERE a.tenant_id=$1 AND a.status='COMPLETED'
            AND ($4::uuid IS NULL OR pr.return_location_id=$4::uuid)
         UNION ALL
         SELECT p.amount, COALESCE(p.refunded_at,p.updated_at) AS occurred_at
           FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='REFUNDED'
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
            AND NOT EXISTS (
              SELECT 1 FROM bms_pos_refund_allocations a
               WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id
            )
       )
       SELECT
         COALESCE((SELECT SUM(p.amount) FROM bms_payments p
                    JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
                   WHERE p.tenant_id=$1 AND p.status IN ('CONFIRMED','REFUNDED')
                     AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
                     AND COALESCE(p.confirmed_at,p.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND COALESCE(p.confirmed_at,p.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS received,
         COALESCE((SELECT SUM(amount) FROM refund_events
                   WHERE occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS refunded,
         COALESCE((SELECT SUM(p.amount) FROM bms_payments p
                    JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
                   WHERE p.tenant_id=$1 AND p.status='PENDING'
                     AND ($4::uuid IS NULL OR o.location_id=$4::uuid)),0) AS pending,
         (SELECT COUNT(*)::int FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='PENDING'
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)) AS pending_count`,
      params
    ),
    query(
      `SELECT p.method AS key, COUNT(*)::int AS count, COALESCE(SUM(p.amount),0) AS amount
         FROM bms_payments p
         JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
        WHERE p.tenant_id=$1 AND p.status IN ('CONFIRMED','REFUNDED')
          AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
          AND COALESCE(p.confirmed_at,p.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND COALESCE(p.confirmed_at,p.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY p.method ORDER BY amount DESC`,
      params
    ),
    query(
      `SELECT p.status AS key, COUNT(*)::int AS count, COALESCE(SUM(p.amount),0) AS amount
         FROM bms_payments p
         JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
        WHERE p.tenant_id=$1 AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
          AND p.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND p.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY p.status ORDER BY count DESC`,
      params
    ),
    query(
      `SELECT COUNT(*)::int AS po_count,
              COALESCE(SUM(total_amount),0) AS ordered_amount,
              COALESCE(SUM(total_amount) FILTER (WHERE status IN ('OPEN','PARTIAL')),0) AS open_amount,
              COUNT(*) FILTER (WHERE status IN ('OPEN','PARTIAL'))::int AS open_count
         FROM bms_purchase_orders
        WHERE tenant_id=$1
          AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      params.slice(0, 3)
    ),
    query(
      `SELECT status AS key, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0) AS amount
         FROM bms_purchase_orders
        WHERE tenant_id=$1
          AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY status ORDER BY amount DESC`,
      params.slice(0, 3)
    ),
    query(
      `SELECT COALESCE(s.name,'(no supplier)') AS key,
              COUNT(*)::int AS count, COALESCE(SUM(po.total_amount),0) AS amount
         FROM bms_purchase_orders po
         LEFT JOIN bms_suppliers s ON s.tenant_id=po.tenant_id AND s.id=po.supplier_id
        WHERE po.tenant_id=$1
          AND po.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND po.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY COALESCE(s.name,'(no supplier)') ORDER BY amount DESC LIMIT 20`,
      params.slice(0, 3)
    ),
    query(
      `WITH paid AS (
         SELECT customer_id, COUNT(*)::int AS orders, SUM(total_amount) AS revenue
           FROM bms_orders
          WHERE tenant_id=$1 AND status = ANY($5)
            AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND COALESCE(paid_at,created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(paid_at,created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          GROUP BY customer_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM bms_customers WHERE tenant_id=$1 AND deleted_at IS NULL) AS total_customers,
         (SELECT COUNT(*)::int FROM bms_customers WHERE tenant_id=$1 AND deleted_at IS NULL
            AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS new_customers,
         COUNT(*) FILTER (WHERE customer_id IS NOT NULL)::int AS purchasing_customers,
         COUNT(*) FILTER (WHERE customer_id IS NOT NULL AND orders > 1)::int AS repeat_customers,
         COALESCE(SUM(orders) FILTER (WHERE customer_id IS NULL),0)::int AS anonymous_orders,
         COALESCE(SUM(revenue) FILTER (WHERE customer_id IS NOT NULL),0) AS identified_revenue
       FROM paid`,
      [...params, PAID]
    ),
    query(
      `SELECT COUNT(*)::int AS shipment_count,
              COUNT(*) FILTER (WHERE status='DELIVERED')::int AS delivered_count,
              COUNT(*) FILTER (WHERE status IN ('PENDING','SHIPPED','IN_TRANSIT'))::int AS in_progress_count,
              COUNT(*) FILTER (WHERE status IN ('RETURNED','CANCELLED'))::int AS exception_count,
              COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at-created_at))/3600)
                FILTER (WHERE status='DELIVERED'),0) AS avg_delivery_hours
         FROM bms_shipments s
         JOIN bms_orders o ON o.tenant_id=s.tenant_id AND o.id=s.order_id
        WHERE s.tenant_id=$1 AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
          AND s.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND s.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`,
      params
    ),
    query(
      `SELECT s.status AS key, COUNT(*)::int AS count, 0::numeric AS amount
         FROM bms_shipments s
         JOIN bms_orders o ON o.tenant_id=s.tenant_id AND o.id=s.order_id
        WHERE s.tenant_id=$1 AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
          AND s.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND s.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY s.status ORDER BY count DESC`,
      params
    ),
    query(
      `SELECT
         COALESCE((SELECT SUM(o.discount_amount) FROM bms_orders o
                    WHERE o.tenant_id=$1 AND o.status = ANY($5)
                      AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
                      AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                      AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS discounts,
         (SELECT COUNT(*)::int FROM bms_orders o WHERE o.tenant_id=$1
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
            AND o.voided_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND o.voided_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS void_count,
         COALESCE((SELECT SUM(o.total_amount) FROM bms_orders o WHERE o.tenant_id=$1
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
            AND o.voided_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND o.voided_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS void_amount,
         (SELECT COUNT(*)::int FROM bms_pos_no_sales n JOIN bms_pos_shifts ps ON ps.id=n.shift_id AND ps.tenant_id=n.tenant_id
            WHERE n.tenant_id=$1 AND ($4::uuid IS NULL OR ps.location_id=$4::uuid)
              AND n.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
              AND n.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS no_sale_count,
         COALESCE((SELECT SUM(CASE WHEN m.direction='IN' THEN m.amount ELSE 0 END) FROM bms_pos_cash_movements m
                    JOIN bms_pos_shifts ps ON ps.id=m.shift_id AND ps.tenant_id=m.tenant_id
                   WHERE m.tenant_id=$1 AND ($4::uuid IS NULL OR ps.location_id=$4::uuid)
                     AND m.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND m.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS cash_in,
         COALESCE((SELECT SUM(CASE WHEN m.direction='OUT' THEN m.amount ELSE 0 END) FROM bms_pos_cash_movements m
                    JOIN bms_pos_shifts ps ON ps.id=m.shift_id AND ps.tenant_id=m.tenant_id
                   WHERE m.tenant_id=$1 AND ($4::uuid IS NULL OR ps.location_id=$4::uuid)
                     AND m.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND m.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS cash_out,
         COALESCE((SELECT SUM(ABS(ps.cash_variance)) FROM bms_pos_shifts ps WHERE ps.tenant_id=$1
                    AND ps.status='CLOSED' AND ($4::uuid IS NULL OR ps.location_id=$4::uuid)
                    AND ps.closed_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                    AND ps.closed_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS absolute_cash_variance,
         (SELECT COUNT(*)::int FROM bms_pos_shifts ps WHERE ps.tenant_id=$1
           AND ps.status='CLOSED' AND ($4::uuid IS NULL OR ps.location_id=$4::uuid)
           AND ps.closed_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
           AND ps.closed_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS closed_shift_count,
         COALESCE((SELECT SUM(w.qty) FROM bms_inventory_wastage w WHERE w.tenant_id=$1
                    AND ($4::uuid IS NULL OR w.location_id=$4::uuid)
                    AND w.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                    AND w.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0)::int AS wastage_qty`,
      [...params, PAID]
    ),
    query(
      `SELECT m.type AS key, COALESCE(SUM(m.qty),0)::int AS count, 0::numeric AS amount
         FROM bms_stock_movements m
        WHERE m.tenant_id=$1 AND ($4::uuid IS NULL OR m.location_id=$4::uuid)
          AND m.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND m.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY m.type ORDER BY count DESC`,
      params
    ),
    getArchetypeReport(tenantId, r.from, r.to, locationId || null),
    getSalesSummary(tenantId, r.from, r.to, locationId),
    getSalesSummary(tenantId, previousFrom, previousTo, locationId),
    getProfitSummary(tenantId, previousFrom, previousTo, locationId),
    query(
      `SELECT
         COALESCE((SELECT SUM(o.total_amount + COALESCE(o.shipping_fee,0) + COALESCE(o.rounding_amount,0))
                     FROM bms_orders o
                    WHERE o.tenant_id=$1 AND o.status=ANY($5)
                      AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
                      AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                      AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS paid_order_amount,
         (SELECT COUNT(*)::int FROM bms_orders o
           WHERE o.tenant_id=$1 AND o.status=ANY($5)
             AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
             AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
             AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS paid_order_count,
         COALESCE((SELECT SUM(d.grand_total) FROM bms_tax_documents d
                   WHERE d.tenant_id=$1 AND d.cancelled_at IS NULL
                     AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
                     AND d.issued_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND d.issued_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS tax_document_amount,
         (SELECT COUNT(*)::int FROM bms_tax_documents d
           WHERE d.tenant_id=$1 AND d.cancelled_at IS NULL
             AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
             AND d.issued_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
             AND d.issued_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS tax_document_count,
         COALESCE((SELECT SUM(s.expected_cash) FROM bms_pos_shifts s
                   WHERE s.tenant_id=$1 AND s.status='CLOSED'
                     AND ($4::uuid IS NULL OR s.location_id=$4::uuid)
                     AND s.closed_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND s.closed_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS expected_cash,
         COALESCE((SELECT SUM(s.counted_cash) FROM bms_pos_shifts s
                   WHERE s.tenant_id=$1 AND s.status='CLOSED'
                     AND ($4::uuid IS NULL OR s.location_id=$4::uuid)
                     AND s.closed_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                     AND s.closed_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS counted_cash,
         (SELECT COUNT(*)::int FROM bms_pos_shifts s
         WHERE s.tenant_id=$1 AND s.status='CLOSED' AND ABS(COALESCE(s.cash_variance,0)) > 0.009
             AND ($4::uuid IS NULL OR s.location_id=$4::uuid)
             AND s.closed_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
             AND s.closed_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')) AS variance_shift_count`,
      [...params, FINANCIAL_ORDER_STATUSES]
    ),
    query(
      `WITH stock AS (
         SELECT i.product_sku, i.size, i.current_stock, i.reserved_stock, i.updated_at,
                p.cost_price,
                GREATEST(0, (now() AT TIME ZONE 'Asia/Bangkok')::date - (i.updated_at AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_days
           FROM bms_inventory i
           JOIN bms_products p ON p.tenant_id=i.tenant_id AND p.sku=i.product_sku
          WHERE i.tenant_id=$1 AND i.current_stock > 0
            AND ($4::uuid IS NULL OR i.location_id=$4::uuid)
       ), sold AS (
         SELECT COALESCE(SUM(oi.qty),0)::numeric AS qty
           FROM bms_order_items oi
           JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
          WHERE oi.tenant_id=$1 AND o.status=ANY($5)
            AND ($4::uuid IS NULL OR o.location_id=$4::uuid)
            AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
       )
       SELECT COUNT(*)::int AS stocked_variants,
              COUNT(*) FILTER (WHERE cost_price IS NULL)::int AS missing_cost_variants,
              COALESCE(SUM(current_stock),0)::int AS stock_units,
              COALESCE(SUM(current_stock * cost_price) FILTER (WHERE cost_price IS NOT NULL),0) AS known_cost_value,
              COUNT(*) FILTER (WHERE age_days BETWEEN 31 AND 60)::int AS age_31_60_count,
              COUNT(*) FILTER (WHERE age_days BETWEEN 61 AND 90)::int AS age_61_90_count,
              COUNT(*) FILTER (WHERE age_days BETWEEN 91 AND 180)::int AS age_91_180_count,
              COUNT(*) FILTER (WHERE age_days > 180)::int AS age_180_plus_count,
              COALESCE(SUM(current_stock * cost_price) FILTER (WHERE age_days > 90 AND cost_price IS NOT NULL),0) AS dead_stock_value,
              COALESCE(SUM(current_stock) FILTER (WHERE age_days > 90),0)::int AS dead_stock_units,
              CASE WHEN sold.qty > 0 THEN COALESCE(SUM(current_stock),0) / (sold.qty / $6::numeric) ELSE NULL END AS estimated_days_cover
         FROM stock CROSS JOIN sold GROUP BY sold.qty`,
      [...params, PAID, periodDays]
    ),
    query(
      `SELECT COALESCE(s.name,'(no supplier)') AS supplier,
              COUNT(DISTINCT po.id)::int AS po_count,
              COALESCE(SUM(item.qty_ordered * item.unit_cost),0) AS ordered_amount,
              COALESCE(SUM(item.qty_received * item.unit_cost),0) AS received_amount,
              COALESCE(SUM(item.qty_received),0)::int AS received_qty,
              COALESCE(SUM(item.qty_ordered),0)::int AS ordered_qty,
              CASE WHEN SUM(item.qty_ordered) > 0
                THEN SUM(item.qty_received)::numeric / SUM(item.qty_ordered) * 100 ELSE 0 END AS fill_rate,
              COALESCE(AVG(EXTRACT(EPOCH FROM (po.updated_at-po.created_at))/86400)
                FILTER (WHERE po.status='RECEIVED'),0) AS avg_lead_days,
              COUNT(DISTINCT po.id) FILTER (WHERE po.status IN ('OPEN','PARTIAL'))::int AS open_po_count
         FROM bms_purchase_orders po
         LEFT JOIN bms_suppliers s ON s.tenant_id=po.tenant_id AND s.id=po.supplier_id
         LEFT JOIN bms_purchase_order_items item ON item.tenant_id=po.tenant_id AND item.po_id=po.id
        WHERE po.tenant_id=$1
          AND po.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND po.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY COALESCE(s.name,'(no supplier)')
        ORDER BY ordered_amount DESC LIMIT 20`,
      params.slice(0, 3)
    ),
    query(
      `WITH paid AS (
         SELECT id, total_amount, discount_amount
           FROM bms_orders
          WHERE tenant_id=$1 AND status=ANY($5)
            AND ($4::uuid IS NULL OR location_id=$4::uuid)
            AND COALESCE(paid_at,created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(paid_at,created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
       )
       SELECT COALESCE(SUM(total_amount),0) AS net_revenue,
              COALESCE(SUM(total_amount + discount_amount),0) AS before_discount_revenue,
              COALESCE(SUM(discount_amount),0) AS discount_amount,
              COUNT(*) FILTER (WHERE discount_amount > 0)::int AS discounted_orders,
              COUNT(*)::int AS paid_orders,
              COALESCE((SELECT COUNT(*) FROM bms_order_items oi JOIN paid p ON p.id=oi.order_id
                WHERE oi.tenant_id=$1
                  AND oi.pricing_snapshot->'promotion' IS NOT NULL
                  AND oi.pricing_snapshot->'promotion' <> 'null'::jsonb),0)::int AS promotion_line_count
         FROM paid`,
      [...params, PAID]
    ),
    query(
      `WITH customer_value AS (
         SELECT o.customer_id, COUNT(*)::int AS frequency, SUM(o.total_amount) AS monetary,
                MAX(COALESCE(o.paid_at,o.created_at)) AS last_paid
           FROM bms_orders o
          WHERE o.tenant_id=$1 AND o.customer_id IS NOT NULL AND o.status=ANY($2)
            AND ($3::uuid IS NULL OR o.location_id=$3::uuid)
          GROUP BY o.customer_id
       ), segmented AS (
         SELECT CASE
           WHEN frequency >= 5 AND last_paid >= now() - interval '30 days' THEN 'CHAMPION'
           WHEN frequency >= 3 AND last_paid >= now() - interval '60 days' THEN 'LOYAL'
           WHEN frequency = 1 AND last_paid >= now() - interval '30 days' THEN 'NEW'
           WHEN last_paid < now() - interval '180 days' THEN 'HIBERNATING'
           WHEN last_paid < now() - interval '90 days' THEN 'AT_RISK'
           ELSE 'PROMISING' END AS segment,
           frequency, monetary
           FROM customer_value
       )
       SELECT segment AS key, COUNT(*)::int AS count, COALESCE(SUM(monetary),0) AS amount
         FROM segmented GROUP BY segment ORDER BY amount DESC`,
      [tenantId, PAID, locationId || null]
    ),
    Promise.all([
      loyaltyOutstandingReport(tenantId),
      getStoreCreditOutstanding(tenantId),
      getArOutstanding(tenantId),
    ]),
  ]);

  const productRows = products.rows.map((row: any) => {
    const revenue = Number(row.revenue ?? 0);
    const qty = Number(row.qty ?? 0);
    const missingCost = qty > 0 && Number(row.missing_cost_lines ?? 0) > 0;
    const profitValue = qty > 0 && !missingCost ? revenue - Number(row.known_cost ?? 0) : qty > 0 ? null : 0;
    return {
      sku: String(row.sku),
      name: String(row.name),
      category: row.category == null ? null : String(row.category),
      qty,
      revenue,
      profit: profitValue,
      marginPct: profitValue == null || revenue <= 0 ? null : (profitValue / revenue) * 100,
      missingCost,
    };
  });
  const soldProducts = productRows.filter((row) => row.qty > 0);
  const customerRow = customers.rows[0] ?? {};
  const purchasingCustomers = Number(customerRow.purchasing_customers ?? 0);
  const repeatCustomers = Number(customerRow.repeat_customers ?? 0);
  const paymentRow = paymentTotals.rows[0] ?? {};
  const purchaseRow = purchaseTotals.rows[0] ?? {};
  const shipmentRow = shipmentTotals.rows[0] ?? {};
  const controlRow = controls.rows[0] ?? {};
  const reconciliationRow = reconciliationRaw.rows[0] ?? {};
  const agingRow = inventoryAgingRaw.rows[0] ?? {};
  const discountRow = discountPerformanceRaw.rows[0] ?? {};
  const [loyalty, storeCredit, ar] = liabilities;
  const paidOrderAmount = Number(reconciliationRow.paid_order_amount ?? 0);
  const receivedAmount = Number(paymentRow.received ?? 0);
  const completedRefundAmount = Number(paymentRow.refunded ?? 0);
  const netPaymentAmount = receivedAmount - completedRefundAmount;
  const netOrderAmount = paidOrderAmount - completedRefundAmount;
  // Both sides include shipping/rounding and retain originally paid RETURNED orders, then subtract refund
  // events in the selected period. Comparing them still exposes timing or linkage mismatches
  // without erasing either side's financial events.
  const paymentDifference = netPaymentAmount - netOrderAmount;
  const expectedCash = Number(reconciliationRow.expected_cash ?? 0);
  const countedCash = Number(reconciliationRow.counted_cash ?? 0);

  return {
    from: r.from,
    to: r.to,
    locationId: locationId || null,
    archetype: archetypeReport,
    profit,
    comparison: {
      previousFrom,
      previousTo,
      currentNetRevenue: currentSales.netRevenue,
      previousNetRevenue: previousSales.netRevenue,
      revenueChangePct: percentChange(currentSales.netRevenue, previousSales.netRevenue),
      currentOrderCount: currentSales.orderCount,
      previousOrderCount: previousSales.orderCount,
      orderChangePct: percentChange(currentSales.orderCount, previousSales.orderCount),
      currentProfit: profit.profit,
      previousProfit: previousProfit.profit,
      profitChangePct: profit.profit == null || previousProfit.profit == null
        ? null
        : percentChange(profit.profit, previousProfit.profit),
    },
    reconciliation: {
      paidOrderCount: Number(reconciliationRow.paid_order_count ?? 0),
      paidOrderAmount,
      paymentReceivedAmount: receivedAmount,
      completedRefundAmount,
      netPaymentAmount,
      netOrderAmount,
      paymentDifference,
      taxDocumentCount: Number(reconciliationRow.tax_document_count ?? 0),
      taxDocumentAmount: Number(reconciliationRow.tax_document_amount ?? 0),
      expectedCash,
      countedCash,
      cashDifference: countedCash - expectedCash,
      varianceShiftCount: Number(reconciliationRow.variance_shift_count ?? 0),
      mismatchCount: (Math.abs(paymentDifference) > 0.009 ? 1 : 0)
        + Number(reconciliationRow.variance_shift_count ?? 0)
        + loyalty.balanceMismatchCount + storeCredit.balanceMismatchCount + ar.balanceMismatchCount,
    },
    inventoryAging: {
      stockedVariantCount: Number(agingRow.stocked_variants ?? 0),
      missingCostVariantCount: Number(agingRow.missing_cost_variants ?? 0),
      stockUnits: Number(agingRow.stock_units ?? 0),
      knownCostValue: Number(agingRow.known_cost_value ?? 0),
      age31To60Count: Number(agingRow.age_31_60_count ?? 0),
      age61To90Count: Number(agingRow.age_61_90_count ?? 0),
      age91To180Count: Number(agingRow.age_91_180_count ?? 0),
      age180PlusCount: Number(agingRow.age_180_plus_count ?? 0),
      deadStockUnits: Number(agingRow.dead_stock_units ?? 0),
      deadStockValue: Number(agingRow.dead_stock_value ?? 0),
      estimatedDaysCover: agingRow.estimated_days_cover == null ? null : Number(agingRow.estimated_days_cover),
      method: "inventory updated_at since last stock-changing write; >90 days is treated as dormant" as const,
    },
    supplierPerformance: supplierPerformanceRaw.rows.map((row: any) => ({
      supplier: String(row.supplier),
      poCount: Number(row.po_count ?? 0),
      orderedAmount: Number(row.ordered_amount ?? 0),
      receivedAmount: Number(row.received_amount ?? 0),
      orderedQty: Number(row.ordered_qty ?? 0),
      receivedQty: Number(row.received_qty ?? 0),
      fillRate: Number(row.fill_rate ?? 0),
      avgLeadDays: Number(row.avg_lead_days ?? 0),
      openPoCount: Number(row.open_po_count ?? 0),
    })),
    discountPerformance: {
      paidOrderCount: Number(discountRow.paid_orders ?? 0),
      discountedOrderCount: Number(discountRow.discounted_orders ?? 0),
      beforeDiscountRevenue: Number(discountRow.before_discount_revenue ?? 0),
      netRevenue: Number(discountRow.net_revenue ?? 0),
      discountAmount: Number(discountRow.discount_amount ?? 0),
      discountRate: Number(discountRow.before_discount_revenue ?? 0) > 0
        ? Number(discountRow.discount_amount ?? 0) / Number(discountRow.before_discount_revenue) * 100
        : 0,
      promotionLineCount: Number(discountRow.promotion_line_count ?? 0),
    },
    customerSegments: reportBuckets(customerSegmentsRaw.rows),
    branches: branches.rows.map((row: any) => ({
      locationId: String(row.id),
      code: String(row.code),
      name: String(row.name),
      orders: Number(row.orders ?? 0),
      revenue: Number(row.revenue ?? 0),
    })),
    products: {
      activeSkuCount: productRows.length,
      soldSkuCount: soldProducts.length,
      unsoldSkuCount: productRows.length - soldProducts.length,
      missingCostSkuCount: soldProducts.filter((row) => row.missingCost).length,
      top: soldProducts.slice(0, 20),
      slow: [...soldProducts].sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, 20),
    },
    payments: {
      receivedAmount: Number(paymentRow.received ?? 0),
      refundedAmount: Number(paymentRow.refunded ?? 0),
      pendingAmount: Number(paymentRow.pending ?? 0),
      pendingCount: Number(paymentRow.pending_count ?? 0),
      byMethod: reportBuckets(paymentMethods.rows),
      byStatus: reportBuckets(paymentStatuses.rows),
    },
    purchases: {
      poCount: Number(purchaseRow.po_count ?? 0),
      orderedAmount: Number(purchaseRow.ordered_amount ?? 0),
      openAmount: Number(purchaseRow.open_amount ?? 0),
      openCount: Number(purchaseRow.open_count ?? 0),
      byStatus: reportBuckets(purchaseStatuses.rows),
      bySupplier: reportBuckets(suppliers.rows),
    },
    customers: {
      totalCustomers: Number(customerRow.total_customers ?? 0),
      newCustomers: Number(customerRow.new_customers ?? 0),
      purchasingCustomers,
      repeatCustomers,
      repeatRate: purchasingCustomers > 0 ? (repeatCustomers / purchasingCustomers) * 100 : 0,
      anonymousOrders: Number(customerRow.anonymous_orders ?? 0),
      identifiedRevenue: Number(customerRow.identified_revenue ?? 0),
      avgRevenuePerCustomer: purchasingCustomers > 0
        ? Number(customerRow.identified_revenue ?? 0) / purchasingCustomers
        : 0,
    },
    fulfillment: {
      shipmentCount: Number(shipmentRow.shipment_count ?? 0),
      deliveredCount: Number(shipmentRow.delivered_count ?? 0),
      inProgressCount: Number(shipmentRow.in_progress_count ?? 0),
      exceptionCount: Number(shipmentRow.exception_count ?? 0),
      avgDeliveryHours: Number(shipmentRow.avg_delivery_hours ?? 0),
      byStatus: reportBuckets(shipmentStatuses.rows),
    },
    controls: {
      discountAmount: Number(controlRow.discounts ?? 0),
      voidCount: Number(controlRow.void_count ?? 0),
      voidAmount: Number(controlRow.void_amount ?? 0),
      noSaleCount: Number(controlRow.no_sale_count ?? 0),
      cashIn: Number(controlRow.cash_in ?? 0),
      cashOut: Number(controlRow.cash_out ?? 0),
      absoluteCashVariance: Number(controlRow.absolute_cash_variance ?? 0),
      closedShiftCount: Number(controlRow.closed_shift_count ?? 0),
      wastageQty: Number(controlRow.wastage_qty ?? 0),
      stockMovements: reportBuckets(stockMovements.rows),
    },
    liabilities: {
      loyaltyPoints: loyalty.outstandingPoints,
      loyaltyValue: loyalty.outstandingValue,
      storeCreditAmount: storeCredit.outstandingAmount,
      arOutstandingAmount: ar.outstandingAmount,
      arOverdueAmount: ar.overdueAmount,
      balanceMismatchCount:
        loyalty.balanceMismatchCount + storeCredit.balanceMismatchCount + ar.balanceMismatchCount,
    },
  };
}
