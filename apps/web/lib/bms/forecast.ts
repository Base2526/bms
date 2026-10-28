// Compatibility adapters for the original staff forecast tools. The single
// source of truth is inventoryIntelligence.ts; keep these public shapes until
// every caller has moved to the branch-aware result.

import { query } from "@/lib/db";
import { getInventoryIntelligence } from "./inventoryIntelligence";
import { forecastDataQualityFromCounts, type ForecastDataQuality } from "./forecastQuality";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

export type { ForecastDataQuality } from "./forecastQuality";

export async function assessForecastDataQuality(tenantId: string, days: number): Promise<ForecastDataQuality> {
  const result = await query<any>(
    `SELECT COUNT(*)::int AS paid_order_count,
            COUNT(DISTINCT (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Bangkok')::date)::int AS active_sales_days
       FROM bms_orders WHERE tenant_id=$1 AND status=ANY($2)
        AND COALESCE(paid_at,created_at)>=now()-make_interval(days=>$3)`,
    [tenantId, PAID_STATUSES, days]
  );
  return forecastDataQualityFromCounts(
    Number(result.rows[0]?.paid_order_count ?? 0),
    Number(result.rows[0]?.active_sales_days ?? 0)
  );
}

export type DemandForecast = {
  method: "heuristic";
  methodVersion: string;
  windowDays: number;
  horizonDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ sku: string; name: string; soldInWindow: number; avgPerDay: number; projected: number }>;
};

export async function forecastDemand(tenantId: string, windowDays = 30, horizonDays = 30, limit = 20): Promise<DemandForecast> {
  const result = await getInventoryIntelligence({ tenantId, windowDays, coverageDays: horizonDays, limit: 100 });
  const bySku = new Map<string, { name: string; sold: number; avg: number }>();
  for (const item of result.items) {
    const current = bySku.get(item.sku) ?? { name: item.name, sold: 0, avg: 0 };
    current.sold += item.soldInWindow;
    current.avg += item.avgPerDay;
    bySku.set(item.sku, current);
  }
  return {
    method: "heuristic",
    methodVersion: result.methodVersion,
    windowDays: result.windowDays,
    horizonDays: result.coverageDays,
    disclaimer: result.disclaimer,
    generatedAt: result.generatedAt,
    dataQuality: result.dataQuality,
    items: [...bySku.entries()].map(([sku, value]) => ({
      sku, name: value.name, soldInWindow: value.sold, avgPerDay: +value.avg.toFixed(3),
      projected: Math.round(value.avg * result.coverageDays),
    })).sort((a, b) => b.projected - a.projected).slice(0, Math.min(Math.max(limit, 1), 100)),
  };
}

export type StockoutRisk = {
  method: "heuristic";
  methodVersion: string;
  windowDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ locationId: string; locationName: string; sku: string; name: string; size: string; available: number; avgPerDay: number; daysToStockout: number | null }>;
};

export async function predictStockOut(tenantId: string, windowDays = 30, limit = 30): Promise<StockoutRisk> {
  const result = await getInventoryIntelligence({ tenantId, windowDays, limit });
  return {
    method: "heuristic", methodVersion: result.methodVersion, windowDays: result.windowDays,
    disclaimer: result.disclaimer, generatedAt: result.generatedAt, dataQuality: result.dataQuality,
    items: result.stockoutRisk.map((item) => ({
      locationId:item.locationId,locationName:item.locationName,sku:item.sku,name:item.name,size:item.size,
      available:item.usableStock,avgPerDay:item.avgPerDay,daysToStockout:item.daysToStockout,
    })),
  };
}

export type PurchaseSuggestion = {
  method: "heuristic";
  methodVersion: string;
  windowDays: number;
  coverageDays: number;
  disclaimer: string;
  generatedAt: string;
  dataQuality: ForecastDataQuality;
  items: Array<{ locationId: string; locationName: string; sku: string; name: string; size: string; available: number; avgPerDay: number; suggestedQty: number }>;
};

export async function suggestPurchaseOrder(tenantId: string, windowDays = 30, coverageDays = 30, limit = 30): Promise<PurchaseSuggestion> {
  const result = await getInventoryIntelligence({ tenantId, windowDays, coverageDays, limit });
  return {
    method:"heuristic",methodVersion:result.methodVersion,windowDays:result.windowDays,coverageDays:result.coverageDays,
    disclaimer:result.disclaimer,generatedAt:result.generatedAt,dataQuality:result.dataQuality,
    items:result.purchaseSuggestions.map((item)=>({locationId:item.locationId,locationName:item.locationName,sku:item.sku,
      name:item.name,size:item.size,available:item.usableStock,avgPerDay:item.avgPerDay,suggestedQty:item.suggestedQty})),
  };
}
