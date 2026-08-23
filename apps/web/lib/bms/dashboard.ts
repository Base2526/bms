// =============================================================
// BMS Dashboard — รวม metric ภาพรวมธุรกิจ (Reporting/Analytics)
// -------------------------------------------------------------
// revenue = ออเดอร์ที่จ่ายแล้ว (PAID ขึ้นไป, ไม่นับ CANCELLED/RETURNED)
// =============================================================

import { query } from "@/lib/db";
import { predictStockOut } from "@/lib/bms/forecast";
import { listLowStock } from "@/lib/bms/products";

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
               AND COALESCE(paid_at,created_at) >= (((now() AT TIME ZONE 'Asia/Bangkok')::date)::timestamp AT TIME ZONE 'Asia/Bangkok')
               AND COALESCE(paid_at,created_at) < ((((now() AT TIME ZONE 'Asia/Bangkok')::date + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok')
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
           FROM generate_series(
             (now() AT TIME ZONE 'Asia/Bangkok')::date - 6,
             (now() AT TIME ZONE 'Asia/Bangkok')::date,
             interval '1 day'
           ) d
           LEFT JOIN bms_orders o
             ON o.tenant_id = $2
            AND COALESCE(o.paid_at,o.created_at) >= (d::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(o.paid_at,o.created_at) < ((d + interval '1 day')::timestamp AT TIME ZONE 'Asia/Bangkok')
          GROUP BY day ORDER BY day`,
        [PAID, tenantId]
      ),
      // ส่วนลดที่แจกไปเดือนนี้ — ไม่กรองตาม status (เหมือน bms_coupons.redemptions_count เดิมที่ไม่
      // ลดตอน cancel/return ก็ตาม เพื่อให้เลขตรงกับ "ใช้ไปแล้ว" ที่โชว์ใน /admin/coupons)
      query(
        `SELECT COALESCE(SUM(discount_amount), 0) AS discount_total, COUNT(*)::int AS redemption_count
           FROM bms_orders
          WHERE tenant_id = $1 AND coupon_code IS NOT NULL
            AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')`,
        [tenantId]
      ),
      query(
        `SELECT coupon_code AS code, COUNT(*)::int AS redemptions, COALESCE(SUM(discount_amount), 0) AS discount
           FROM bms_orders
          WHERE tenant_id = $1 AND coupon_code IS NOT NULL
            AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
          GROUP BY coupon_code
          ORDER BY redemptions DESC LIMIT 5`,
        [tenantId]
      ),
      query(
        `WITH top_codes AS (
            SELECT coupon_code AS code
              FROM bms_orders
             WHERE tenant_id = $1 AND coupon_code IS NOT NULL
               AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
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
               AND o.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
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

export async function getInventoryActionCenter(
  tenantId: string,
  windowDays = 30,
  coverageDays = 30,
  limit = 5
) {
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  const safeWindowDays = Math.min(Math.max(windowDays, 7), 180);
  const safeCoverageDays = Math.min(Math.max(coverageDays, 1), 180);
  const [lowStockRows, stockoutMeta, intelligence, expiring] = await Promise.all([
    listLowStock(tenantId),
    predictStockOut(tenantId, safeWindowDays, 1),
    query<any>(
      `WITH sales AS (
         SELECT oi.product_sku sku, oi.size,
           COALESCE(SUM(oi.qty) FILTER (WHERE COALESCE(o.paid_at,o.created_at) >= now()-make_interval(days=>$2)),0)::int sold_recent,
           COALESCE(SUM(oi.qty) FILTER (WHERE COALESCE(o.paid_at,o.created_at) < now()-make_interval(days=>$2) AND COALESCE(o.paid_at,o.created_at) >= now()-make_interval(days=>$2*2)),0)::int sold_previous
         FROM bms_order_items oi JOIN bms_orders o ON o.id=oi.order_id AND o.tenant_id=$1
         WHERE o.status=ANY($3) AND COALESCE(o.paid_at,o.created_at) >= now()-make_interval(days=>$2*2)
         GROUP BY oi.product_sku,oi.size
       ), demand AS (
         SELECT sku,size,SUM(qty)::int qty FROM (
           SELECT product_sku sku,size,qty FROM bms_inventory_demand_events
           WHERE tenant_id=$1 AND occurred_at >= now()-make_interval(days=>$2)
           UNION ALL
           SELECT product_sku sku,size,requested_qty qty FROM bms_restock_subscriptions
           WHERE tenant_id=$1 AND status IN ('ACTIVE','READY_TO_NOTIFY','NOTIFIED')
         ) unmet GROUP BY sku,size
       ), incoming AS (
         SELECT poi.product_sku sku,poi.size,COALESCE(SUM(poi.qty_ordered-poi.qty_received),0)::int qty
         FROM bms_purchase_order_items poi JOIN bms_purchase_orders po ON po.id=poi.po_id AND po.tenant_id=$1
         WHERE poi.tenant_id=$1 AND po.status IN ('OPEN','PARTIAL') GROUP BY poi.product_sku,poi.size
       )
       SELECT i.product_sku sku,p.name,i.size,(i.current_stock-i.reserved_stock)::int available,
         COALESCE(s.sold_recent,0)::int sold_recent,COALESCE(s.sold_previous,0)::int sold_previous,
         COALESCE(d.qty,0)::int demand_feedback,COALESCE(inc.qty,0)::int incoming,
         COALESCE(pol.safety_stock_days,7)::int safety_stock_days,COALESCE(pol.lead_time_days,7)::int lead_time_days
       FROM bms_inventory i JOIN bms_products p ON p.tenant_id=i.tenant_id AND p.sku=i.product_sku
       LEFT JOIN sales s ON s.sku=i.product_sku AND s.size=i.size
       LEFT JOIN demand d ON d.sku=i.product_sku AND d.size=i.size
       LEFT JOIN incoming inc ON inc.sku=i.product_sku AND inc.size=i.size
       LEFT JOIN bms_inventory_policies pol ON pol.tenant_id=i.tenant_id AND pol.product_sku=i.product_sku AND pol.size=i.size
       WHERE i.tenant_id=$1 AND p.active`, [tenantId, safeWindowDays, PAID]
    ),
    query<any>(
      `SELECT l.product_sku sku,p.name,l.size,l.lot_no,l.expiry_date,l.qty::int,
              (l.expiry_date-(now() AT TIME ZONE 'Asia/Bangkok')::date)::int days_to_expiry
       FROM bms_inventory_lots l JOIN bms_products p ON p.tenant_id=l.tenant_id AND p.sku=l.product_sku
       WHERE l.tenant_id=$1 AND l.qty>0 AND l.expiry_date IS NOT NULL
         AND l.expiry_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date+60
       ORDER BY l.expiry_date,l.qty DESC`, [tenantId]
    ),
  ]);

  const outOfStockNow = lowStockRows.filter((row) => Number(row.available) <= 0);
  const forecastSufficient = stockoutMeta.dataQuality.status === "SUFFICIENT";
  const advanced = intelligence.rows.map((r: any) => {
    const observed = Number(r.sold_recent) + Number(r.demand_feedback);
    const avgPerDay = observed / safeWindowDays;
    const trendPct = Number(r.sold_previous) > 0 ? ((Number(r.sold_recent)-Number(r.sold_previous))/Number(r.sold_previous))*100 : (Number(r.sold_recent)>0 ? 100 : 0);
    const safetyStock = Math.ceil(avgPerDay * Number(r.safety_stock_days));
    const target = Math.ceil(avgPerDay * (Number(r.lead_time_days)+Number(r.safety_stock_days)+safeCoverageDays));
    const suggestedQty = Math.max(0, target-Number(r.available)-Number(r.incoming));
    const classification = !forecastSufficient
      ? "INSUFFICIENT_DATA"
      : Number(r.available) <= 0
        ? "OUT_OF_STOCK"
        : observed === 0 && Number(r.available)>0
          ? "DEAD"
          : Number(r.available) > observed*3 ? "SLOW" : "HEALTHY";
    const daysToStockout = avgPerDay > 0 ? +(Math.max(Number(r.available),0)/avgPerDay).toFixed(1) : null;
    const projectedStockoutDate = daysToStockout === null ? null : new Date(Date.now()+Math.ceil(daysToStockout)*86_400_000).toISOString().slice(0,10);
    return { sku:r.sku,name:r.name,size:r.size,available:Number(r.available),soldInWindow:Number(r.sold_recent),demandFeedback:Number(r.demand_feedback),incomingQty:Number(r.incoming),avgPerDay:+avgPerDay.toFixed(3),daysToStockout:forecastSufficient?daysToStockout:null,projectedStockoutDate:forecastSufficient?projectedStockoutDate:null,trendPct:+trendPct.toFixed(1),safetyStock,leadTimeDays:Number(r.lead_time_days),suggestedQty:forecastSufficient?suggestedQty:0,classification,
      recommendedAction: classification === "INSUFFICIENT_DATA" ? "COLLECT_MORE_DATA" : classification === "DEAD" ? "DISCONTINUE_OR_BUNDLE" : classification === "SLOW" ? "MARKDOWN_TRANSFER_OR_BUNDLE" : suggestedQty>0 ? "REORDER" : "MONITOR" };
  });
  const slowMoving = advanced.filter((x: any) => x.classification === "SLOW" || x.classification === "DEAD")
    .sort((a: any,b: any) => b.available-a.available);
  const enhancedPurchases = advanced.filter((x: any) => x.suggestedQty>0).sort((a: any,b: any) => b.suggestedQty-a.suggestedQty);
  const enhancedStockoutRisk = advanced.filter((x: any) => x.daysToStockout !== null).sort((a: any,b: any) => a.daysToStockout-b.daysToStockout);
  const stockoutWithin7Days = enhancedStockoutRisk.filter((item: any) => item.daysToStockout <= 7);
  const expiringItems = expiring.rows.map((r: any) => ({ sku:r.sku,name:r.name,size:r.size,lotNo:r.lot_no,expiryDate:r.expiry_date instanceof Date ? r.expiry_date.toISOString().slice(0,10) : String(r.expiry_date),qty:Number(r.qty),daysToExpiry:Number(r.days_to_expiry),recommendedAction:Number(r.days_to_expiry)<=0 ? "BLOCK_AND_DISPOSE" : Number(r.days_to_expiry)<=30 ? "FEFO_MARKDOWN_OR_TRANSFER" : "FEFO_PRIORITY" }));

  return {
    summary: {
      lowStockCount: lowStockRows.length,
      outOfStockCount: outOfStockNow.length,
      stockoutWithin7DaysCount: stockoutWithin7Days.length,
      purchaseSuggestionCount: enhancedPurchases.length,
      totalSuggestedQty: enhancedPurchases.reduce((sum: number,item: any)=>sum+item.suggestedQty,0),
      slowMovingCount: slowMoving.length,
      deadStockCount: slowMoving.filter((x: any)=>x.classification === "DEAD").length,
      expiringLotCount: expiringItems.length,
      expiringUnits: expiringItems.reduce((sum: number,item: any)=>sum+item.qty,0),
      windowDays: safeWindowDays,
      coverageDays: safeCoverageDays,
      disclaimer: stockoutMeta.disclaimer,
      dataQuality: stockoutMeta.dataQuality,
    },
    lowStock: lowStockRows.slice(0, safeLimit).map((row) => ({
      sku: row.sku,
      name: row.name,
      size: row.size,
      available: Number(row.available),
      reorderPoint: Number(row.reorder_point),
    })),
    stockoutRisk: enhancedStockoutRisk.slice(0, safeLimit),
    purchaseSuggestions: enhancedPurchases.slice(0, safeLimit),
    slowMoving: slowMoving.slice(0, safeLimit),
    expiringLots: expiringItems.slice(0, safeLimit),
  };
}
