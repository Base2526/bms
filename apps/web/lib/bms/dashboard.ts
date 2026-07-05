// =============================================================
// BMS Dashboard — รวม metric ภาพรวมธุรกิจ (Reporting/Analytics)
// -------------------------------------------------------------
// revenue = ออเดอร์ที่จ่ายแล้ว (PAID ขึ้นไป, ไม่นับ CANCELLED/RETURNED)
// =============================================================

import { query } from "@/lib/db";

const PAID = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

export async function getDashboard(tenantId: string) {
  const [summary, byStatus, low, custCount, topProducts, topCustomers, daily] =
    await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($1)), 0) AS revenue_total,
           COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($1) AND created_at::date = current_date), 0) AS revenue_today,
           COUNT(*) AS order_count
         FROM bms_orders WHERE tenant_id = $2`,
        [PAID, tenantId]
      ),
      query(`SELECT status, COUNT(*)::int AS count FROM bms_orders WHERE tenant_id = $1 GROUP BY status`, [tenantId]),
      query(
        `SELECT COUNT(*)::int AS c FROM bms_inventory i
           JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
          WHERE i.tenant_id = $1 AND p.active AND (i.current_stock - i.reserved_stock) <= i.reorder_point`,
        [tenantId]
      ),
      query(`SELECT COUNT(*)::int AS c FROM bms_customers WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
      query(
        `SELECT oi.product_sku AS sku, p.name,
                SUM(oi.qty)::int AS qty,
                SUM(oi.qty * oi.unit_price) AS revenue
           FROM bms_order_items oi
           JOIN bms_orders o ON o.id = oi.order_id
           JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
          WHERE oi.tenant_id = $2 AND o.status = ANY($1)
          GROUP BY oi.product_sku, p.name
          ORDER BY qty DESC LIMIT 5`,
        [PAID, tenantId]
      ),
      query(
        `SELECT c.id, c.name, c.tags,
                SUM(o.total_amount) AS spent, COUNT(o.id)::int AS orders
           FROM bms_customers c
           JOIN bms_orders o ON o.customer_id = c.id
          WHERE c.tenant_id = $2 AND o.status = ANY($1) AND c.deleted_at IS NULL
          GROUP BY c.id, c.name, c.tags
          ORDER BY spent DESC LIMIT 5`,
        [PAID, tenantId]
      ),
      query(
        `SELECT d::date AS day,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($1)), 0) AS revenue,
                COUNT(o.id) FILTER (WHERE o.status = ANY($1))::int AS orders
           FROM generate_series(current_date - 6, current_date, interval '1 day') d
           LEFT JOIN bms_orders o ON o.created_at::date = d::date AND o.tenant_id = $2
          GROUP BY day ORDER BY day`,
        [PAID, tenantId]
      ),
    ]);

  const s = summary.rows[0];
  return {
    revenueTotal: Number(s.revenue_total),
    revenueToday: Number(s.revenue_today),
    orderCount: Number(s.order_count),
    lowStockCount: low.rows[0].c,
    customerCount: custCount.rows[0].c,
    ordersByStatus: byStatus.rows.map((r: any) => ({ status: r.status, count: r.count })),
    topProducts: topProducts.rows.map((r: any) => ({
      sku: r.sku, name: r.name, qty: r.qty, revenue: Number(r.revenue),
    })),
    topCustomers: topCustomers.rows.map((r: any) => ({
      id: r.id, name: r.name, tags: r.tags ?? [], spent: Number(r.spent), orders: r.orders,
    })),
    salesDaily: daily.rows.map((r: any) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      revenue: Number(r.revenue),
      orders: r.orders,
    })),
  };
}
