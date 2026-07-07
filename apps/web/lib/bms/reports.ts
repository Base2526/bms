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
          AND created_at::date BETWEEN $3 AND $4`,
      [tenantId, PAID, r.from, r.to]
    ),
    query(
      `SELECT d::date AS day,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($2)), 0) AS revenue,
              COUNT(o.id) FILTER (WHERE o.status = ANY($2))::int AS orders
         FROM generate_series($3::date, $4::date, interval '1 day') d
         LEFT JOIN bms_orders o
           ON o.created_at::date = d::date AND o.tenant_id = $1
        GROUP BY day ORDER BY day`,
      [tenantId, PAID, r.from, r.to]
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
         FROM bms_orders
        WHERE tenant_id = $1 AND created_at::date BETWEEN $2 AND $3
        GROUP BY status ORDER BY count DESC`,
      [tenantId, r.from, r.to]
    ),
    query(
      `SELECT channel,
              COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($2)), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS orders
         FROM bms_orders
        WHERE tenant_id = $1 AND created_at::date BETWEEN $3 AND $4
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
       JOIN bms_orders o ON o.id = oi.order_id
       JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND o.status = ANY($2)
        AND o.created_at::date BETWEEN $3 AND $4
      GROUP BY oi.product_sku, p.name
      ORDER BY qty DESC
      LIMIT $5`,
    [tenantId, PAID, r.from, r.to, lim]
  );
  return res.rows.map((x: any) => ({ sku: x.sku, name: x.name, qty: x.qty, revenue: Number(x.revenue) }));
}
