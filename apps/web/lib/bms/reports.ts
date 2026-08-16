// =============================================================
// BMS Reports — report tools แยกส่วน (TOOLS.md §Reports)
// -------------------------------------------------------------
// getSalesSummary(from,to)  : ยอดขายช่วงวันที่ (revenue/orders/by-day/status/channel)
// getInventorySummary()     : สรุปสต็อก (มูลค่า, ใกล้หมด, หมด)
// getTopSellingProducts()   : สินค้าขายดีในช่วงวันที่
//
// revenue นับเฉพาะออเดอร์ที่จ่ายแล้ว (PAID ขึ้นไป, ไม่นับ CANCELLED/RETURNED)
// tenant-scoped ทุก query — ตรงกับหลักใน dashboard.ts
// =============================================================

import { query } from "@/lib/db";

const PAID = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
const RETURN_REASON_PREFIX_RE = /^\[([A-Z_]+)\]\s*/;

function parseReturnReason(note: string | null | undefined) {
  const text = String(note ?? "").trim();
  const match = text.match(RETURN_REASON_PREFIX_RE);
  return {
    reasonCode: match?.[1] ?? "UNSPECIFIED",
    reasonText: text.replace(RETURN_REASON_PREFIX_RE, "") || "(no detail)",
  };
}

/** normalize ช่วงวันที่: default = 30 วันล่าสุด (YYYY-MM-DD) */
function range(from?: string | null, to?: string | null): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const toD = from && to ? to : to || iso(new Date());
  const fromD = from || iso(new Date(Date.now() - 29 * 864e5));
  return { from: fromD, to: toD };
}

export async function getSalesSummary(tenantId: string, from?: string | null, to?: string | null) {
  const r = range(from, to);

  const [totals, byDay, byStatus, byChannel] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue,
              COUNT(*)::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1 AND status = ANY($2)
          AND created_at >= $3::date
          AND created_at < $4::date + interval '1 day'`,
      [tenantId, PAID, r.from, r.to]
    ),
    query(
      `SELECT d::date AS day,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($2)), 0) AS revenue,
              COUNT(o.id) FILTER (WHERE o.status = ANY($2))::int AS orders
         FROM generate_series($3::date, $4::date, interval '1 day') d
         LEFT JOIN bms_orders o
           ON o.tenant_id = $1
          AND o.created_at >= d
          AND o.created_at < d + interval '1 day'
        GROUP BY day ORDER BY day`,
      [tenantId, PAID, r.from, r.to]
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
         FROM bms_orders
        WHERE tenant_id = $1
          AND created_at >= $2::date
          AND created_at < $3::date + interval '1 day'
        GROUP BY status ORDER BY count DESC`,
      [tenantId, r.from, r.to]
    ),
    query(
      `SELECT channel,
              COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($2)), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1
          AND created_at >= $3::date
          AND created_at < $4::date + interval '1 day'
        GROUP BY channel ORDER BY revenue DESC`,
      [tenantId, PAID, r.from, r.to]
    ),
  ]);

  const revenue = Number(totals.rows[0].revenue);
  const orders = Number(totals.rows[0].orders);
  const toISO = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  return {
    from: r.from,
    to: r.to,
    revenue,
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
      `SELECT MIN(created_at)::date AS first_order_date,
              MAX(created_at)::date AS last_order_date,
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

export async function getInventorySummary(tenantId: string) {
  const res = await query(
    `SELECT
        COUNT(DISTINCT p.sku) FILTER (WHERE p.active)::int AS sku_count,
        COUNT(i.*)::int AS variant_count,
        COALESCE(SUM(i.current_stock), 0)::int AS total_units,
        COALESCE(SUM(i.reserved_stock), 0)::int AS reserved_units,
        COALESCE(SUM(i.current_stock - i.reserved_stock), 0)::int AS available_units,
        COALESCE(SUM(i.current_stock * p.price), 0) AS stock_value,
        COUNT(*) FILTER (WHERE p.active AND (i.current_stock - i.reserved_stock) <= i.reorder_point)::int AS low_stock_count,
        COUNT(*) FILTER (WHERE p.active AND i.current_stock = 0)::int AS out_of_stock_count
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1`,
    [tenantId]
  );
  const s = res.rows[0];
  return {
    skuCount: s.sku_count,
    variantCount: s.variant_count,
    totalUnits: s.total_units,
    reservedUnits: s.reserved_units,
    availableUnits: s.available_units,
    stockValue: Number(s.stock_value),
    lowStockCount: s.low_stock_count,
    outOfStockCount: s.out_of_stock_count,
  };
}

export async function getTopSellingProducts(
  tenantId: string,
  from?: string | null,
  to?: string | null,
  limit = 10
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
        AND o.created_at >= $3::date
        AND o.created_at < $4::date + interval '1 day'
      GROUP BY oi.product_sku, p.name
      ORDER BY qty DESC
      LIMIT $5`,
    [tenantId, PAID, r.from, r.to, lim]
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

/**
 * ประเมินกำไรขั้นต้น — ใช้ราคาต้นทุน**ปัจจุบัน**ของสินค้า (bms_products.cost_price) เทียบกับ
 * unit_price ที่ snapshot ไว้จริงใน bms_order_items เพราะ order item ไม่ได้เก็บ cost snapshot
 * ตอนขาย ดังนั้นตัวเลขนี้เป็น**ค่าประเมิน**เท่านั้น (method: "approximate") ถ้าต้นทุนสินค้าเปลี่ยนไป
 * หลังวันที่ขายจริง กำไรที่คำนวณได้จะไม่ตรงกับกำไรจริง ณ วันนั้น — ห้ามนำไปแสดงเป็นตัวเลขที่แน่นอน
 * (แนวทางเดียวกับ forecast.ts ที่ tag ทุกผลลัพธ์ด้วย method + disclaimer)
 */
export async function getProfitSummary(tenantId: string, from?: string | null, to?: string | null) {
  const r = range(from, to);
  const [totals, byDay] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(oi.qty * oi.unit_price), 0) AS revenue,
              COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost
         FROM bms_order_items oi
         JOIN bms_orders o ON o.id = oi.order_id
         JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
        WHERE oi.tenant_id = $1 AND o.status = ANY($2)
          AND o.created_at >= $3::date
          AND o.created_at < $4::date + interval '1 day'`,
      [tenantId, PAID, r.from, r.to]
    ),
    query(
      `SELECT o.created_at::date AS day,
              COALESCE(SUM(oi.qty * oi.unit_price), 0) AS revenue,
              COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost
         FROM bms_order_items oi
         JOIN bms_orders o ON o.id = oi.order_id
         JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
        WHERE oi.tenant_id = $1 AND o.status = ANY($2)
          AND o.created_at >= $3::date
          AND o.created_at < $4::date + interval '1 day'
        GROUP BY day ORDER BY day`,
      [tenantId, PAID, r.from, r.to]
    ),
  ]);

  const revenue = Number(totals.rows[0].revenue);
  const cost = Number(totals.rows[0].cost);
  const profit = revenue - cost;
  const toISO = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  return {
    method: "approximate" as const,
    disclaimer:
      "กำไรนี้คำนวณจากต้นทุนสินค้าปัจจุบัน ไม่ใช่ต้นทุน ณ วันที่ขายจริง — ใช้เป็นค่าประมาณ ไม่ใช่ตัวเลขบัญชีที่แน่นอน",
    from: r.from,
    to: r.to,
    revenue,
    cost,
    profit,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    byDay: byDay.rows.map((x: any) => ({
      day: toISO(x.day),
      revenue: Number(x.revenue),
      cost: Number(x.cost),
      profit: Number(x.revenue) - Number(x.cost),
    })),
  };
}

export async function getPosReturnSummary(tenantId: string, from?: string | null, to?: string | null) {
  const r = range(from, to);
  const [totals, reasons, recent] = await Promise.all([
    query(
      `WITH selected_returns AS (
         SELECT id, refund_amount
           FROM bms_pos_returns
          WHERE tenant_id = $1
            AND created_at >= $2::date
            AND created_at < $3::date + interval '1 day'
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
      [tenantId, r.from, r.to]
    ),
    query(
      `SELECT COALESCE(NULLIF(trim(note), ''), '(no reason)') AS note,
              COUNT(*)::int AS count
         FROM bms_pos_returns
        WHERE tenant_id = $1
          AND created_at >= $2::date
          AND created_at < $3::date + interval '1 day'
        GROUP BY 1
        ORDER BY count DESC, note
        LIMIT 5`,
      [tenantId, r.from, r.to]
    ),
    query(
      `SELECT pr.id,
              pr.order_id,
              pr.refund_amount,
              pr.return_mode,
              pr.settlement_status,
              pr.note,
              pr.created_at,
              COALESCE(u.name, u.email, pr.returned_by::text) AS returned_by,
              COALESCE((SELECT SUM(a.amount) FROM bms_pos_refund_allocations a
                         WHERE a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
                           AND a.status = 'COMPLETED'), 0) AS settled_amount,
              COALESCE((SELECT SUM(a.amount) FROM bms_pos_refund_allocations a
                         WHERE a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
                           AND a.status = 'PENDING'), 0) AS pending_amount
         FROM bms_pos_returns pr
         LEFT JOIN users u ON u.id = pr.returned_by
        WHERE pr.tenant_id = $1
          AND pr.created_at >= $2::date
          AND pr.created_at < $3::date + interval '1 day'
        ORDER BY pr.created_at DESC
        LIMIT 10`,
      [tenantId, r.from, r.to]
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

export async function getPosReturnAuditSummary(tenantId: string, from?: string | null, to?: string | null) {
  const r = range(from, to);
  const [byCashier, approvals] = await Promise.all([
    query(
      `SELECT COALESCE(u.name, u.email, pr.returned_by::text, 'unknown') AS cashier,
              COUNT(*)::int AS return_count,
              COALESCE(SUM(pr.refund_amount), 0) AS refund_total
         FROM bms_pos_returns pr
         LEFT JOIN users u ON u.id = pr.returned_by
        WHERE pr.tenant_id = $1
          AND pr.created_at >= $2::date
          AND pr.created_at < $3::date + interval '1 day'
        GROUP BY 1
        ORDER BY refund_total DESC, return_count DESC
        LIMIT 10`,
      [tenantId, r.from, r.to]
    ),
    query(
      `SELECT
          COUNT(*) FILTER (WHERE refund_amount >= 500)::int AS approval_candidate_count,
          COUNT(*) FILTER (WHERE refund_amount >= 2000)::int AS high_value_return_count,
          COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int AS approved_count,
          COUNT(*) FILTER (WHERE refund_amount >= 500 AND approved_by IS NULL)::int AS missing_approval_count
         FROM bms_pos_returns
        WHERE tenant_id = $1
          AND created_at >= $2::date
          AND created_at < $3::date + interval '1 day'`,
      [tenantId, r.from, r.to]
    ),
  ]);

  return {
    from: r.from,
    to: r.to,
    byCashier: byCashier.rows.map((row: any) => ({
      cashier: String(row.cashier ?? "unknown"),
      returnCount: Number(row.return_count ?? 0),
      refundTotal: Number(row.refund_total ?? 0),
    })),
    approvalCandidateCount: Number(approvals.rows[0]?.approval_candidate_count ?? 0),
    highValueReturnCount: Number(approvals.rows[0]?.high_value_return_count ?? 0),
    approvedCount: Number(approvals.rows[0]?.approved_count ?? 0),
    missingApprovalCount: Number(approvals.rows[0]?.missing_approval_count ?? 0),
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
    ].filter(Boolean),
  };
}
