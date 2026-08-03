// =============================================================
// BMS Dashboard — รวม metric ภาพรวมธุรกิจ (Reporting/Analytics)
// -------------------------------------------------------------
// revenue = ออเดอร์ที่จ่ายแล้ว (PAID ขึ้นไป, ไม่นับ CANCELLED/RETURNED)
// =============================================================

import { query } from "@/lib/db";

const PAID = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

const PACKING_OVERDUE_HOURS = 24;
const SLIP_PENDING_HOURS = 2;
const CHAT_WAITING_MINUTES = 30;
const RESERVATION_EXPIRE_MINUTES = 30;       // matches release-expired-orders default (?minutes=30)
const RESERVATION_WARN_MINUTES = 20;          // warn window: 20–30 min old, not yet auto-released

export async function getDashboard(tenantId: string) {
  const [summary, byStatus, low, custCount, topProducts, topCustomers, daily, couponMonth, topCoupons, couponUsages] =
    await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(total_amount) FILTER (WHERE status = ANY($1)), 0) AS revenue_total,
           COALESCE(SUM(total_amount) FILTER (
             WHERE status = ANY($1)
               AND created_at >= current_date
               AND created_at < current_date + interval '1 day'
           ), 0) AS revenue_today,
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
           LEFT JOIN bms_orders o
             ON o.tenant_id = $2
            AND o.created_at >= d
            AND o.created_at < d + interval '1 day'
          GROUP BY day ORDER BY day`,
        [PAID, tenantId]
      ),
      // ส่วนลดที่แจกไปเดือนนี้ — ไม่กรองตาม status (เหมือน bms_coupons.redemptions_count เดิมที่ไม่
      // ลดตอน cancel/return ก็ตาม เพื่อให้เลขตรงกับ "ใช้ไปแล้ว" ที่โชว์ใน /admin/coupons)
      query(
        `SELECT COALESCE(SUM(discount_amount), 0) AS discount_total, COUNT(*)::int AS redemption_count
           FROM bms_orders
          WHERE tenant_id = $1 AND coupon_code IS NOT NULL
            AND created_at >= date_trunc('month', current_date)`,
        [tenantId]
      ),
      query(
        `SELECT coupon_code AS code, COUNT(*)::int AS redemptions, COALESCE(SUM(discount_amount), 0) AS discount
           FROM bms_orders
          WHERE tenant_id = $1 AND coupon_code IS NOT NULL
            AND created_at >= date_trunc('month', current_date)
          GROUP BY coupon_code
          ORDER BY redemptions DESC LIMIT 5`,
        [tenantId]
      ),
      query(
        `WITH top_codes AS (
            SELECT coupon_code AS code
              FROM bms_orders
             WHERE tenant_id = $1 AND coupon_code IS NOT NULL
               AND created_at >= date_trunc('month', current_date)
             GROUP BY coupon_code
             ORDER BY COUNT(*) DESC
             LIMIT 5
          ),
          ranked AS (
            SELECT o.coupon_code AS code, o.id AS order_id, o.customer_id, o.channel, o.status,
                   o.total_amount, o.discount_amount, o.created_at,
                   COALESCE(NULLIF(c.name, o.customer_ref), ci.display_name, o.customer_ref) AS customer_name,
                   ROW_NUMBER() OVER (PARTITION BY o.coupon_code ORDER BY o.created_at DESC) AS rn
              FROM bms_orders o
              JOIN top_codes tc ON tc.code = o.coupon_code
              LEFT JOIN bms_customers c ON c.id = o.customer_id
              LEFT JOIN bms_customer_identities ci
                ON ci.tenant_id = o.tenant_id AND ci.channel = o.channel AND ci.external_ref = o.customer_ref
             WHERE o.tenant_id = $1
               AND o.created_at >= date_trunc('month', current_date)
          )
          SELECT code, order_id, customer_id, channel, status, total_amount, discount_amount, created_at, customer_name
            FROM ranked
           WHERE rn <= 10
           ORDER BY code, created_at DESC`,
        [tenantId]
      ),
    ]);

  const s = summary.rows[0];
  const cm = couponMonth.rows[0];
  const usagesByCode = new Map<string, any[]>();
  for (const r of couponUsages.rows as any[]) {
    const code = String(r.code);
    const rows = usagesByCode.get(code) ?? [];
    rows.push({
      orderId: r.order_id,
      customerId: r.customer_id ?? null,
      customerName: r.customer_name ?? null,
      channel: r.channel,
      status: r.status,
      discountAmount: Number(r.discount_amount),
      totalAmount: Number(r.total_amount),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    });
    usagesByCode.set(code, rows);
  }
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
    couponSummary: {
      discountThisMonth: Number(cm.discount_total),
      redemptionsThisMonth: cm.redemption_count,
      topCoupons: topCoupons.rows.map((r: any) => ({
        code: r.code, redemptions: r.redemptions, discount: Number(r.discount), usages: usagesByCode.get(String(r.code)) ?? [],
      })),
    },
  };
}

/** นับงานค้างที่ต้องรีบจัดการวันนี้ — แยกจาก getDashboard() เพราะเป็นคนละหมวด (alert ไม่ใช่ analytics) */
export async function getOperationalAlerts(tenantId: string) {
  const [packing, slips, reservations, chats] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS c FROM bms_orders
        WHERE tenant_id = $1 AND status = 'PACKING'
          AND updated_at < now() - make_interval(hours => $2)`,
      [tenantId, PACKING_OVERDUE_HOURS]
    ),
    query(
      `SELECT COUNT(*)::int AS c FROM bms_payments
        WHERE tenant_id = $1 AND status = 'PENDING'
          AND created_at < now() - make_interval(hours => $2)`,
      [tenantId, SLIP_PENDING_HOURS]
    ),
    query(
      `SELECT COUNT(*)::int AS c FROM bms_orders
        WHERE tenant_id = $1 AND status = 'PENDING'
          AND created_at < now() - make_interval(mins => $2)
          AND created_at >= now() - make_interval(mins => $3)`,
      [tenantId, RESERVATION_WARN_MINUTES, RESERVATION_EXPIRE_MINUTES]
    ),
    query(
      `SELECT COUNT(*)::int AS c FROM bms_conversations
        WHERE tenant_id = $1 AND status <> 'CLOSED' AND unread > 0
          AND last_message_at < now() - make_interval(mins => $2)`,
      [tenantId, CHAT_WAITING_MINUTES]
    ),
  ]);

  return {
    packingOverdueCount: packing.rows[0].c,
    slipPendingCount: slips.rows[0].c,
    reservationExpiringCount: reservations.rows[0].c,
    chatWaitingCount: chats.rows[0].c,
  };
}
