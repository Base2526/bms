// =============================================================
// BMS forecast — heuristic จากยอดขายจริง (ไม่มี schema ใหม่)
// -------------------------------------------------------------
// AI_GUIDELINES: forecast ต้องบอกช่วงข้อมูล/สมมติฐาน/ความไม่แน่นอน และ
//   ต้องให้มนุษย์ review ก่อนใช้เปลี่ยน purchasing/pricing/inventory
// method = "heuristic" (moving-average velocity) — ไม่ใช่ ML, ไม่การันตี
// นับยอดขายจาก order ที่ชำระแล้ว (PAID ขึ้นไป) เท่านั้น เหมือน reports.ts
// =============================================================

import { query } from "@/lib/db";
import {
  forecastDataQualityFromCounts,
  type ForecastDataQuality,
} from "./forecastQuality";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
const DISCLAIMER =
  "ประมาณการจากค่าเฉลี่ยยอดขายย้อนหลัง (heuristic) ไม่ใช่การพยากรณ์แม่นยำ — ควรใช้ประกอบการตัดสินใจ ไม่ใช่ตัวเลขรับประกัน";

type SoldRow = { sku: string; size: string; sold: number };

export type { ForecastDataQuality } from "./forecastQuality";

export async function assessForecastDataQuality(
  tenantId: string,
  days: number
): Promise<ForecastDataQuality> {
  const result = await query<any>(
    `SELECT COUNT(*)::int AS paid_order_count,
            COUNT(DISTINCT (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Bangkok')::date)::int
              AS active_sales_days
       FROM bms_orders
      WHERE tenant_id = $1
        AND status = ANY($2)
        AND COALESCE(paid_at, created_at) >= now() - make_interval(days => $3)`,
    [tenantId, PAID_STATUSES, days]
  );
  const paidOrderCount = Number(result.rows[0]?.paid_order_count ?? 0);
  const activeSalesDays = Number(result.rows[0]?.active_sales_days ?? 0);
  return forecastDataQualityFromCounts(paidOrderCount, activeSalesDays);
}

/** ยอดขาย (หน่วย) ต่อ (sku,size) ในช่วง N วันล่าสุด */
async function soldByVariant(tenantId: string, days: number): Promise<SoldRow[]> {
  const res = await query<any>(
    `SELECT oi.product_sku AS sku, oi.size, SUM(oi.qty)::int AS sold
       FROM bms_order_items oi
       JOIN bms_orders o ON o.id = oi.order_id AND o.tenant_id = $1
      WHERE o.status = ANY($2)
        AND COALESCE(o.paid_at, o.created_at) >= now() - make_interval(days => $3)
      GROUP BY oi.product_sku, oi.size`,
    [tenantId, PAID_STATUSES, days]
  );
  return res.rows.map((r) => ({ sku: r.sku, size: r.size, sold: Number(r.sold) }));
}

export type DemandForecast = {
  method: "heuristic";
  windowDays: number;
  horizonDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ sku: string; name: string; soldInWindow: number; avgPerDay: number; projected: number }>;
};

/** คาดการณ์ความต้องการรวมต่อ sku ใน horizonDays ข้างหน้า จากค่าเฉลี่ย windowDays ที่ผ่านมา */
export async function forecastDemand(tenantId: string, windowDays = 30, horizonDays = 30, limit = 20): Promise<DemandForecast> {
  const win = Math.min(Math.max(windowDays, 7), 180);
  const horizon = Math.min(Math.max(horizonDays, 1), 180);
  const dataQuality = await assessForecastDataQuality(tenantId, win);
  const generatedAt = new Date().toISOString();
  if (dataQuality.status === "INSUFFICIENT") {
    return {
      method: "heuristic",
      windowDays: win,
      horizonDays: horizon,
      disclaimer: `${DISCLAIMER} — ${dataQuality.reason}`,
      generatedAt,
      dataQuality,
      items: [],
    };
  }
  const rows = await soldByVariant(tenantId, win);

  const bySku = new Map<string, number>();
  for (const r of rows) bySku.set(r.sku, (bySku.get(r.sku) ?? 0) + r.sold);

  const skus = [...bySku.keys()];
  const names = new Map<string, string>();
  if (skus.length) {
    const n = await query<any>(
      `SELECT sku, name FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2)`,
      [tenantId, skus]
    );
    for (const r of n.rows) names.set(r.sku, r.name);
  }

  const items = [...bySku.entries()]
    .map(([sku, sold]) => {
      const avgPerDay = sold / win;
      return { sku, name: names.get(sku) ?? sku, soldInWindow: sold, avgPerDay: +avgPerDay.toFixed(3), projected: Math.round(avgPerDay * horizon) };
    })
    .sort((a, b) => b.projected - a.projected)
    .slice(0, limit);

  return { method: "heuristic", windowDays: win, horizonDays: horizon, disclaimer: DISCLAIMER, generatedAt, dataQuality, items };
}

export type StockoutRisk = {
  method: "heuristic";
  windowDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ sku: string; name: string; size: string; available: number; avgPerDay: number; daysToStockout: number | null }>;
};

/** ประเมินว่าแต่ละไซซ์จะหมดสต็อกในกี่วัน จาก velocity ล่าสุด (เรียงเสี่ยงสุดก่อน) */
export async function predictStockOut(tenantId: string, windowDays = 30, limit = 30): Promise<StockoutRisk> {
  const win = Math.min(Math.max(windowDays, 7), 180);
  const dataQuality = await assessForecastDataQuality(tenantId, win);
  const generatedAt = new Date().toISOString();
  if (dataQuality.status === "INSUFFICIENT") {
    return {
      method: "heuristic",
      windowDays: win,
      disclaimer: `${DISCLAIMER} — ${dataQuality.reason}`,
      generatedAt,
      dataQuality,
      items: [],
    };
  }
  const rows = await query<any>(
    `SELECT i.product_sku AS sku, i.size, p.name,
            (i.current_stock - i.reserved_stock) AS available,
            COALESCE(s.sold, 0) AS sold
       FROM bms_inventory i
       JOIN bms_products p ON p.sku = i.product_sku AND p.tenant_id = $1
       LEFT JOIN (
         SELECT oi.product_sku, oi.size, SUM(oi.qty)::int AS sold
           FROM bms_order_items oi
           JOIN bms_orders o ON o.id = oi.order_id AND o.tenant_id = $1
          WHERE o.status = ANY($2) AND COALESCE(o.paid_at, o.created_at) >= now() - make_interval(days => $3)
          GROUP BY oi.product_sku, oi.size
       ) s ON s.product_sku = i.product_sku AND s.size = i.size
      WHERE i.tenant_id = $1 AND p.active`,
    [tenantId, PAID_STATUSES, win]
  );

  const items = rows.rows
    .map((r) => {
      const available = Number(r.available);
      const avgPerDay = Number(r.sold) / win;
      const daysToStockout = avgPerDay > 0 ? +(available / avgPerDay).toFixed(1) : null;
      return { sku: r.sku, name: r.name ?? r.sku, size: r.size, available, avgPerDay: +avgPerDay.toFixed(3), daysToStockout };
    })
    .filter((x) => x.daysToStockout !== null) // เฉพาะที่มี velocity (คำนวณได้)
    .sort((a, b) => (a.daysToStockout! - b.daysToStockout!))
    .slice(0, limit);

  return { method: "heuristic", windowDays: win, disclaimer: DISCLAIMER, generatedAt, dataQuality, items };
}

export type PurchaseSuggestion = {
  method: "heuristic";
  windowDays: number;
  coverageDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ sku: string; name: string; size: string; available: number; avgPerDay: number; suggestedQty: number }>;
};

/** เสนอจำนวนสั่งซื้อเพื่อให้มีของพอขาย coverageDays วัน (เฉพาะที่คาดว่าจะขาด) */
export async function suggestPurchaseOrder(tenantId: string, windowDays = 30, coverageDays = 30, limit = 30): Promise<PurchaseSuggestion> {
  const risk = await predictStockOut(tenantId, windowDays, 1000);
  const items = risk.items
    .map((r) => {
      const needed = Math.ceil(r.avgPerDay * coverageDays);
      const suggestedQty = Math.max(0, needed - r.available);
      return { sku: r.sku, name: r.name, size: r.size, available: r.available, avgPerDay: r.avgPerDay, suggestedQty };
    })
    .filter((x) => x.suggestedQty > 0)
    .sort((a, b) => b.suggestedQty - a.suggestedQty)
    .slice(0, limit);

  return {
    method: "heuristic",
    windowDays: risk.windowDays,
    coverageDays,
    disclaimer: risk.disclaimer,
    generatedAt: risk.generatedAt,
    dataQuality: risk.dataQuality,
    items,
  };
}
