import { createHash } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { forecastDataQualityFromCounts, type ForecastDataQuality } from "./forecastQuality";
import { usableStockSql } from "./lotQuality";
import { beginTenantTx } from "./tenant";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
const METHOD = "branch_stock_consumption_velocity";
export const INVENTORY_INTELLIGENCE_METHOD_VERSION = "2.0";
const DISCLAIMER =
  "ประมาณการจาก stock consumption และ demand ที่ตรวจสอบได้ ไม่ใช่ตัวเลขรับประกัน — ต้องให้พนักงานตรวจสอบก่อนซื้อ โอน หรือปรับสต็อก";

export type InventoryIntelligenceInput = {
  tenantId: string;
  allowedLocationIds?: readonly string[] | null;
  includeUnallocated?: boolean;
  locationId?: string | null;
  sku?: string | null;
  size?: string | null;
  windowDays?: number;
  coverageDays?: number;
  limit?: number;
  offset?: number;
};

export type InventoryIntelligenceItem = {
  locationId: string;
  locationName: string;
  sku: string;
  name: string;
  size: string;
  currentStock: number;
  reservedStock: number;
  quarantineStock: number;
  usableStock: number;
  reorderPoint: number;
  soldInWindow: number;
  soldPreviousWindow: number;
  confirmedDemand: number;
  allocatedIncoming: number;
  avgPerDay: number;
  trendPct: number;
  safetyStockDays: number;
  safetyStock: number;
  leadTimeDays: number;
  policySource: "LOCATION" | "TENANT" | "DEFAULT";
  daysToStockout: number | null;
  projectedStockoutDate: string | null;
  suggestedQty: number;
  classification: "INSUFFICIENT_DATA" | "OUT_OF_STOCK" | "DEAD" | "SLOW" | "HEALTHY";
  recommendedAction: "COLLECT_MORE_DATA" | "REORDER" | "MARKDOWN_TRANSFER_OR_BUNDLE" | "DISCONTINUE_OR_BUNDLE" | "MONITOR";
};

export type UnallocatedInventorySignal = {
  sku: string;
  size: string;
  qty: number;
};

export type InventoryIntelligenceResult = {
  method: typeof METHOD;
  methodVersion: string;
  generatedAt: string;
  verifiedAt: string;
  windowDays: number;
  coverageDays: number;
  assumptions: string[];
  disclaimer: string;
  dataQuality: ForecastDataQuality;
  summary: {
    lowStockCount: number;
    outOfStockCount: number;
    stockoutWithin7DaysCount: number;
    purchaseSuggestionCount: number;
    totalSuggestedQty: number;
    slowMovingCount: number;
    deadStockCount: number;
    expiringLotCount: number;
    expiringUnits: number;
    unallocatedDemandUnits: number;
    unallocatedIncomingUnits: number;
  };
  items: InventoryIntelligenceItem[];
  lowStock: InventoryIntelligenceItem[];
  stockoutRisk: InventoryIntelligenceItem[];
  purchaseSuggestions: InventoryIntelligenceItem[];
  slowMoving: InventoryIntelligenceItem[];
  expiringLots: Array<{
    locationId: string;
    locationName: string;
    sku: string;
    name: string;
    size: string;
    lotNo: string;
    expiryDate: string;
    qty: number;
    daysToExpiry: number;
    recommendedAction: "BLOCK_AND_DISPOSE" | "FEFO_MARKDOWN_OR_TRANSFER" | "FEFO_PRIORITY";
  }>;
  unallocatedDemand: UnallocatedInventorySignal[];
  unallocatedIncoming: UnallocatedInventorySignal[];
  totalCount: number;
  truncated: boolean;
  nextOffset: number | null;
};

function boundedInt(value: number | undefined, min: number, max: number, fallback: number) {
  const n = Number.isFinite(value) ? Math.floor(Number(value)) : fallback;
  return Math.min(Math.max(n, min), max);
}

function isoDateAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date());
  const value = (type:string) => Number(parts.find((part)=>part.type===type)?.value);
  return new Date(Date.UTC(value("year"),value("month")-1,value("day")+Math.max(0,Math.ceil(days))))
    .toISOString().slice(0,10);
}

export async function getInventoryIntelligence(input: InventoryIntelligenceInput): Promise<InventoryIntelligenceResult> {
  const windowDays = boundedInt(input.windowDays, 7, 180, 30);
  const coverageDays = boundedInt(input.coverageDays, 1, 180, 30);
  const limit = boundedInt(input.limit, 1, 100, 20);
  const offset = boundedInt(input.offset, 0, 100_000, 0);
  const locationId = input.locationId?.trim() || null;
  const sku = input.sku?.trim() || null;
  const size = input.size?.trim().toUpperCase() || null;
  const allowed = input.allowedLocationIds ? [...input.allowedLocationIds] : null;
  const includeUnallocated = input.includeUnallocated ?? allowed === null;
  if (locationId && allowed && !allowed.includes(locationId)) throw new Error("ไม่มีสิทธิ์ดูสาขานี้");

  const params = [input.tenantId, windowDays, PAID_STATUSES, locationId, allowed, sku, size];
  const [qualityRows, rows, expiring, unallocatedDemandRows, unallocatedIncomingRows] = await Promise.all([
    query<{ paid_order_count: number; active_sales_days: number }>(
      `SELECT COUNT(DISTINCT o.id)::int AS paid_order_count,
              COUNT(DISTINCT (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date)::int AS active_sales_days
         FROM bms_orders o
        WHERE o.tenant_id=$1 AND o.status=ANY($3)
          AND COALESCE(o.paid_at,o.created_at)>=now()-make_interval(days=>$2)
          AND ($4::uuid IS NULL OR o.location_id=$4)
          AND ($5::uuid[] IS NULL OR o.location_id=ANY($5))
          AND ($6::text IS NULL OR EXISTS (
            SELECT 1 FROM bms_order_stock_lines sl
             WHERE sl.tenant_id=o.tenant_id AND sl.order_id=o.id
               AND sl.product_sku=$6 AND ($7::text IS NULL OR sl.size=$7)
          ))`,
      params
    ),
    query<any>(
      `WITH sales AS (
         SELECT sl.location_id,sl.product_sku sku,sl.size,
           COALESCE(SUM(sl.qty) FILTER (WHERE COALESCE(o.paid_at,o.created_at)>=now()-make_interval(days=>$2)),0)::int sold_recent,
           COALESCE(SUM(sl.qty) FILTER (WHERE COALESCE(o.paid_at,o.created_at)<now()-make_interval(days=>$2)),0)::int sold_previous
         FROM bms_order_stock_lines sl
         JOIN bms_orders o ON o.tenant_id=sl.tenant_id AND o.id=sl.order_id
         WHERE sl.tenant_id=$1 AND o.status=ANY($3)
           AND COALESCE(o.paid_at,o.created_at)>=now()-make_interval(days=>$2*2)
         GROUP BY sl.location_id,sl.product_sku,sl.size
       ), local_demand AS (
         SELECT location_id,product_sku sku,size,SUM(qty)::int qty
           FROM bms_inventory_demand_events
          WHERE tenant_id=$1 AND location_id IS NOT NULL
            AND occurred_at>=now()-make_interval(days=>$2)
          GROUP BY location_id,product_sku,size
       ), allocated_incoming AS (
         SELECT r.location_id,ri.product_sku sku,ri.size,
           SUM(LEAST(rp.qty,GREATEST(poi.qty_ordered-poi.qty_received,0)))::int qty
           FROM bms_branch_requisition_purchases rp
           JOIN bms_branch_requisition_items ri ON ri.tenant_id=rp.tenant_id AND ri.id=rp.item_id
           JOIN bms_branch_requisitions r ON r.tenant_id=ri.tenant_id AND r.id=ri.requisition_id
           JOIN bms_purchase_order_items poi ON poi.tenant_id=rp.tenant_id AND poi.id=rp.po_item_id
           JOIN bms_purchase_orders po ON po.tenant_id=poi.tenant_id AND po.id=poi.po_id
          WHERE rp.tenant_id=$1 AND r.status NOT IN ('REJECTED','CANCELLED') AND po.status IN ('OPEN','PARTIAL')
          GROUP BY r.location_id,ri.product_sku,ri.size
       )
       SELECT i.location_id,l.name location_name,i.product_sku sku,p.name,i.size,
              i.current_stock::int,i.reserved_stock::int,i.quarantine_stock::int,
              ${usableStockSql("i")} usable_stock,i.reorder_point::int,
              COALESCE(s.sold_recent,0)::int sold_recent,COALESCE(s.sold_previous,0)::int sold_previous,
              COALESCE(d.qty,0)::int confirmed_demand,COALESCE(inc.qty,0)::int allocated_incoming,
              COALESCE(lp.safety_stock_days,tp.safety_stock_days,7)::int safety_stock_days,
              COALESCE(lp.lead_time_days,tp.lead_time_days,7)::int lead_time_days,
              CASE WHEN lp.tenant_id IS NOT NULL THEN 'LOCATION' WHEN tp.tenant_id IS NOT NULL THEN 'TENANT' ELSE 'DEFAULT' END policy_source
         FROM bms_inventory i
         JOIN bms_products p ON p.tenant_id=i.tenant_id AND p.sku=i.product_sku AND p.active
         JOIN bms_locations l ON l.tenant_id=i.tenant_id AND l.id=i.location_id AND l.active
         LEFT JOIN sales s ON s.location_id=i.location_id AND s.sku=i.product_sku AND s.size=i.size
         LEFT JOIN local_demand d ON d.location_id=i.location_id AND d.sku=i.product_sku AND d.size=i.size
         LEFT JOIN allocated_incoming inc ON inc.location_id=i.location_id AND inc.sku=i.product_sku AND inc.size=i.size
         LEFT JOIN bms_inventory_location_policies lp ON lp.tenant_id=i.tenant_id AND lp.location_id=i.location_id AND lp.product_sku=i.product_sku AND lp.size=i.size
         LEFT JOIN bms_inventory_policies tp ON tp.tenant_id=i.tenant_id AND tp.product_sku=i.product_sku AND tp.size=i.size
        WHERE i.tenant_id=$1
          AND ($4::uuid IS NULL OR i.location_id=$4)
          AND ($5::uuid[] IS NULL OR i.location_id=ANY($5))
          AND ($6::text IS NULL OR i.product_sku=$6)
          AND ($7::text IS NULL OR i.size=$7)
        ORDER BY l.name,p.name,i.size`,
      params
    ),
    query<any>(
      `SELECT lot.location_id,l.name location_name,lot.product_sku sku,p.name,lot.size,lot.lot_no,lot.expiry_date,lot.qty::int,
              (lot.expiry_date-(now() AT TIME ZONE 'Asia/Bangkok')::date)::int days_to_expiry
         FROM bms_inventory_lots lot
         JOIN bms_products p ON p.tenant_id=lot.tenant_id AND p.sku=lot.product_sku
         JOIN bms_locations l ON l.tenant_id=lot.tenant_id AND l.id=lot.location_id
        WHERE lot.tenant_id=$1 AND lot.qty>0 AND lot.expiry_date IS NOT NULL
          AND lot.expiry_date<=(now() AT TIME ZONE 'Asia/Bangkok')::date+60
          AND ($4::uuid IS NULL OR lot.location_id=$4)
          AND ($5::uuid[] IS NULL OR lot.location_id=ANY($5))
          AND ($6::text IS NULL OR lot.product_sku=$6)
          AND ($7::text IS NULL OR lot.size=$7)
        ORDER BY lot.expiry_date,lot.qty DESC`,
      params
    ),
    includeUnallocated ? query<any>(
      `SELECT product_sku sku,size,SUM(qty)::int qty FROM (
         SELECT product_sku,size,qty FROM bms_inventory_demand_events
          WHERE tenant_id=$1 AND location_id IS NULL AND occurred_at>=now()-make_interval(days=>$2)
         UNION ALL
         SELECT product_sku,size,requested_qty qty FROM bms_restock_subscriptions
          WHERE tenant_id=$1 AND status IN ('ACTIVE','READY_TO_NOTIFY','NOTIFIED')
       ) q WHERE ($6::text IS NULL OR product_sku=$6) AND ($7::text IS NULL OR size=$7)
       GROUP BY product_sku,size ORDER BY qty DESC`,
      params
    ) : Promise.resolve({ rows: [] }),
    includeUnallocated ? query<any>(
      `WITH remaining AS (
         SELECT poi.id,poi.product_sku sku,poi.size,GREATEST(poi.qty_ordered-poi.qty_received,0)::int qty
           FROM bms_purchase_order_items poi
           JOIN bms_purchase_orders po ON po.tenant_id=poi.tenant_id AND po.id=poi.po_id
          WHERE poi.tenant_id=$1 AND po.status IN ('OPEN','PARTIAL')
       ), allocated AS (
         SELECT rp.po_item_id,SUM(rp.qty)::int qty
           FROM bms_branch_requisition_purchases rp
           JOIN bms_branch_requisition_items ri ON ri.tenant_id=rp.tenant_id AND ri.id=rp.item_id
           JOIN bms_branch_requisitions r ON r.tenant_id=ri.tenant_id AND r.id=ri.requisition_id
          WHERE rp.tenant_id=$1 AND r.status NOT IN ('REJECTED','CANCELLED') GROUP BY rp.po_item_id
       )
       SELECT rem.sku,rem.size,SUM(GREATEST(rem.qty-COALESCE(a.qty,0),0))::int qty
         FROM remaining rem LEFT JOIN allocated a ON a.po_item_id=rem.id
        WHERE ($6::text IS NULL OR rem.sku=$6) AND ($7::text IS NULL OR rem.size=$7)
        GROUP BY rem.sku,rem.size HAVING SUM(GREATEST(rem.qty-COALESCE(a.qty,0),0))>0
        ORDER BY qty DESC`,
      params
    ) : Promise.resolve({ rows: [] }),
  ]);

  const quality = forecastDataQualityFromCounts(
    Number(qualityRows.rows[0]?.paid_order_count ?? 0),
    Number(qualityRows.rows[0]?.active_sales_days ?? 0)
  );
  const sufficient = quality.status === "SUFFICIENT";
  const allItems: InventoryIntelligenceItem[] = rows.rows.map((row: any) => {
    const usableStock = Number(row.usable_stock);
    const soldRecent = Number(row.sold_recent);
    const confirmedDemand = Number(row.confirmed_demand);
    const observed = soldRecent + confirmedDemand;
    const avgPerDay = observed / windowDays;
    const previous = Number(row.sold_previous);
    const trendPct = previous > 0 ? ((soldRecent - previous) / previous) * 100 : soldRecent > 0 ? 100 : 0;
    const safetyStockDays = Number(row.safety_stock_days);
    const leadTimeDays = Number(row.lead_time_days);
    const safetyStock = Math.ceil(avgPerDay * safetyStockDays);
    const target = Math.ceil(avgPerDay * (leadTimeDays + safetyStockDays + coverageDays));
    const suggestedQty = sufficient ? Math.max(0, target - usableStock - Number(row.allocated_incoming)) : 0;
    const classification: InventoryIntelligenceItem["classification"] = !sufficient
      ? "INSUFFICIENT_DATA"
      : usableStock <= 0
        ? "OUT_OF_STOCK"
        : observed === 0
          ? "DEAD"
          : usableStock > observed * 3 ? "SLOW" : "HEALTHY";
    const daysToStockout = sufficient && avgPerDay > 0 ? +(Math.max(usableStock, 0) / avgPerDay).toFixed(1) : null;
    const recommendedAction: InventoryIntelligenceItem["recommendedAction"] = classification === "INSUFFICIENT_DATA"
      ? "COLLECT_MORE_DATA"
      : classification === "DEAD"
        ? "DISCONTINUE_OR_BUNDLE"
        : classification === "SLOW"
          ? "MARKDOWN_TRANSFER_OR_BUNDLE"
          : suggestedQty > 0 ? "REORDER" : "MONITOR";
    return {
      locationId: String(row.location_id), locationName: String(row.location_name), sku: String(row.sku),
      name: String(row.name), size: String(row.size), currentStock: Number(row.current_stock),
      reservedStock: Number(row.reserved_stock), quarantineStock: Number(row.quarantine_stock), usableStock,
      reorderPoint: Number(row.reorder_point), soldInWindow: soldRecent, soldPreviousWindow: previous,
      confirmedDemand, allocatedIncoming: Number(row.allocated_incoming), avgPerDay: +avgPerDay.toFixed(3),
      trendPct: +trendPct.toFixed(1), safetyStockDays, safetyStock, leadTimeDays,
      policySource: row.policy_source, daysToStockout,
      projectedStockoutDate: daysToStockout == null ? null : isoDateAfter(daysToStockout), suggestedQty,
      classification, recommendedAction,
    };
  });

  const unallocatedDemand = unallocatedDemandRows.rows.map((row: any) => ({ sku: String(row.sku), size: String(row.size), qty: Number(row.qty) }));
  const unallocatedIncoming = unallocatedIncomingRows.rows.map((row: any) => ({ sku: String(row.sku), size: String(row.size), qty: Number(row.qty) }));
  const lowStockAll = allItems.filter((item) => item.usableStock <= item.reorderPoint).sort((a, b) => a.usableStock - b.usableStock);
  const stockoutRiskAll = allItems.filter((item) => item.daysToStockout != null).sort((a, b) => a.daysToStockout! - b.daysToStockout!);
  const purchaseAll = allItems.filter((item) => item.suggestedQty > 0).sort((a, b) => b.suggestedQty - a.suggestedQty);
  const slowAll = allItems.filter((item) => item.classification === "SLOW" || item.classification === "DEAD")
    .sort((a, b) => b.usableStock - a.usableStock);
  const expiringLots = expiring.rows.map((row: any) => {
    const days = Number(row.days_to_expiry);
    return {
      locationId: String(row.location_id), locationName: String(row.location_name), sku: String(row.sku),
      name: String(row.name), size: String(row.size), lotNo: String(row.lot_no),
      expiryDate: row.expiry_date instanceof Date ? row.expiry_date.toISOString().slice(0, 10) : String(row.expiry_date),
      qty: Number(row.qty), daysToExpiry: days,
      recommendedAction: (days <= 0 ? "BLOCK_AND_DISPOSE" : days <= 30 ? "FEFO_MARKDOWN_OR_TRANSFER" : "FEFO_PRIORITY") as
        "BLOCK_AND_DISPOSE" | "FEFO_MARKDOWN_OR_TRANSFER" | "FEFO_PRIORITY",
    };
  });
  const paged = allItems.slice(offset, offset + limit);
  const truncated = offset + limit < allItems.length;
  const slice = <T>(values: T[]) => values.slice(offset, offset + limit);
  return {
    method: METHOD,
    methodVersion: INVENTORY_INTELLIGENCE_METHOD_VERSION,
    generatedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    windowDays,
    coverageDays,
    assumptions: [
      "ยอดใช้สต็อกอ่านจาก bms_order_stock_lines ซึ่งเป็น sale-time stock consumption snapshot",
      "ของพร้อมขายตัดล็อตหมดอายุ lot hold และกรณียอดล็อต reconcile ไม่ได้",
      "PO และ demand ที่ยังไม่มีสาขาแสดงแยกและไม่ถูกกระจายซ้ำทุกสาขา",
    ],
    disclaimer: quality.reason ? `${DISCLAIMER} — ${quality.reason}` : DISCLAIMER,
    dataQuality: quality,
    summary: {
      lowStockCount: lowStockAll.length,
      outOfStockCount: allItems.filter((item) => item.usableStock <= 0).length,
      stockoutWithin7DaysCount: stockoutRiskAll.filter((item) => item.daysToStockout! <= 7).length,
      purchaseSuggestionCount: purchaseAll.length,
      totalSuggestedQty: purchaseAll.reduce((sum, item) => sum + item.suggestedQty, 0),
      slowMovingCount: slowAll.length,
      deadStockCount: slowAll.filter((item) => item.classification === "DEAD").length,
      expiringLotCount: expiringLots.length,
      expiringUnits: expiringLots.reduce((sum, item) => sum + item.qty, 0),
      unallocatedDemandUnits: unallocatedDemand.reduce((sum, item) => sum + item.qty, 0),
      unallocatedIncomingUnits: unallocatedIncoming.reduce((sum, item) => sum + item.qty, 0),
    },
    items: paged,
    lowStock: slice(lowStockAll),
    stockoutRisk: slice(stockoutRiskAll),
    purchaseSuggestions: slice(purchaseAll),
    slowMoving: slice(slowAll),
    expiringLots: slice(expiringLots),
    unallocatedDemand,
    unallocatedIncoming,
    totalCount: allItems.length,
    truncated,
    nextOffset: truncated ? offset + limit : null,
  };
}

export async function explainInventoryRisk(input: InventoryIntelligenceInput & { sku: string; size: string }) {
  const result = await getInventoryIntelligence({ ...input, limit: 100, offset: 0 });
  return {
    method: result.method,
    methodVersion: result.methodVersion,
    generatedAt: result.generatedAt,
    dataQuality: result.dataQuality,
    disclaimer: result.disclaimer,
    items: result.items,
    unallocatedDemand: result.unallocatedDemand,
    unallocatedIncoming: result.unallocatedIncoming,
    formula: "ceil(avgPerDay × (leadTimeDays + safetyStockDays + coverageDays)) - usableStock - allocatedIncoming",
  };
}

export async function findInventoryTransferOpportunities(input: InventoryIntelligenceInput) {
  const result = await getInventoryIntelligence({ ...input, limit: 100, offset: 0 });
  const items = result.items;
  const opportunities: Array<{sku:string;name:string;size:string;fromLocationId:string;fromLocationName:string;toLocationId:string;toLocationName:string;qty:number;donorSurplus:number;receiverShortage:number;reason:string}> = [];
  for (const receiver of items.filter((item)=>item.suggestedQty>0)) {
    let remaining=receiver.suggestedQty;
    const donors=items.filter((item)=>item.sku===receiver.sku&&item.size===receiver.size&&item.locationId!==receiver.locationId)
      .map((item)=>({item,surplus:Math.max(0,item.usableStock-item.safetyStock-Math.ceil(item.avgPerDay*result.coverageDays))}))
      .filter((entry)=>entry.surplus>0).sort((a,b)=>b.surplus-a.surplus);
    for (const donor of donors) {
      if (remaining<=0) break;
      const qty=Math.min(remaining,donor.surplus);
      opportunities.push({sku:receiver.sku,name:receiver.name,size:receiver.size,fromLocationId:donor.item.locationId,
        fromLocationName:donor.item.locationName,toLocationId:receiver.locationId,toLocationName:receiver.locationName,
        qty,donorSurplus:donor.surplus,receiverShortage:receiver.suggestedQty,
        reason:"โอนเฉพาะ usable stock ที่เหลือเหนือ safety stock และ demand coverage ของสาขาต้นทาง"});
      remaining-=qty;
    }
  }
  return {method:result.method,methodVersion:result.methodVersion,generatedAt:result.generatedAt,dataQuality:result.dataQuality,
    disclaimer:result.disclaimer,items:opportunities.slice(0,Math.min(Math.max(input.limit??20,1),50)),
    totalCount:opportunities.length,truncated:opportunities.length>(input.limit??20)};
}

export async function recordInventoryForecastSnapshot(input: InventoryIntelligenceInput & { horizonDays?: number }) {
  const first = await getInventoryIntelligence({ ...input, limit: 100, offset: 0 });
  const forecastItems = [...first.items];
  for (let offset = 100; offset < first.totalCount; offset += 100) {
    const page = await getInventoryIntelligence({ ...input, limit: 100, offset });
    forecastItems.push(...page.items);
  }
  const horizonDays = boundedInt(input.horizonDays, 1, 180, first.coverageDays);
  const evidenceDigest = createHash("sha256").update(JSON.stringify({
    method: first.method, methodVersion: first.methodVersion, windowDays: first.windowDays,
    horizonDays, items: forecastItems.map((item) => [item.locationId, item.sku, item.size, item.avgPerDay]),
  })).digest("hex");
  const targetDate = isoDateAfter(horizonDays);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);
    const run = await client.query<{ id: string }>(
      `INSERT INTO bms_inventory_forecast_runs
        (tenant_id,method,method_version,window_days,horizon_days,data_quality,evidence_digest)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (tenant_id,method_version,window_days,horizon_days,snapshot_date) DO NOTHING
       RETURNING id`,
      [input.tenantId, first.method, first.methodVersion, first.windowDays, horizonDays, JSON.stringify(first.dataQuality), evidenceDigest]
    );
    if (!run.rowCount) {
      const existing = await client.query<{id:string}>(
        `SELECT id FROM bms_inventory_forecast_runs
          WHERE tenant_id=$1 AND method_version=$2 AND window_days=$3 AND horizon_days=$4
            AND snapshot_date=(now() AT TIME ZONE 'Asia/Bangkok')::date`,
        [input.tenantId, first.methodVersion, first.windowDays, horizonDays]
      );
      await client.query("COMMIT");
      return {runId:existing.rows[0]?.id ?? null,targetDate,itemCount:0,evidenceDigest,replayed:true};
    }
    const runId = run.rows[0].id;
    for (const item of forecastItems) {
      const predicted = +(item.avgPerDay * horizonDays).toFixed(3);
      await client.query(
        `INSERT INTO bms_inventory_forecast_items
          (tenant_id,run_id,location_id,product_sku,size,target_date,predicted_qty,lower_bound,upper_bound)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [input.tenantId, runId, item.locationId, item.sku, item.size, targetDate, predicted,
          +(predicted * 0.7).toFixed(3), +(predicted * 1.3).toFixed(3)]
      );
    }
    await client.query("COMMIT");
    return { runId, targetDate, itemCount: forecastItems.length, evidenceDigest };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateDueInventoryForecasts(tenantId: string): Promise<number> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const updated = await client.query(
      `WITH actuals AS (
         SELECT fi.id,COALESCE(SUM(sl.qty) FILTER (WHERE o.id IS NOT NULL),0)::numeric AS actual_qty
           FROM bms_inventory_forecast_items fi
           JOIN bms_inventory_forecast_runs fr ON fr.tenant_id=fi.tenant_id AND fr.id=fi.run_id
           LEFT JOIN bms_order_stock_lines sl ON sl.tenant_id=fi.tenant_id AND sl.location_id=fi.location_id
            AND sl.product_sku=fi.product_sku AND sl.size=fi.size
           LEFT JOIN bms_orders o ON o.tenant_id=sl.tenant_id AND o.id=sl.order_id
            AND o.status=ANY($2::text[]) AND COALESCE(o.paid_at,o.created_at)>=fr.generated_at
            AND COALESCE(o.paid_at,o.created_at)<fi.target_date+1
          WHERE fi.tenant_id=$1 AND fi.actual_qty IS NULL
            AND fi.target_date<(now() AT TIME ZONE 'Asia/Bangkok')::date
          GROUP BY fi.id
       )
       UPDATE bms_inventory_forecast_items fi
          SET actual_qty=a.actual_qty,evaluated_at=now()
         FROM actuals a WHERE fi.tenant_id=$1 AND fi.id=a.id`,
      [tenantId, PAID_STATUSES]
    );
    await client.query("COMMIT");
    return updated.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getInventoryForecastAccuracy(input: {
  tenantId: string;
  allowedLocationIds?: readonly string[] | null;
  locationId?: string | null;
  days?: number;
}) {
  const days = boundedInt(input.days, 7, 365, 90);
  const locationId = input.locationId?.trim() || null;
  const allowed = input.allowedLocationIds ? [...input.allowedLocationIds] : null;
  if (locationId && allowed && !allowed.includes(locationId)) throw new Error("ไม่มีสิทธิ์ดูสาขานี้");
  const result = await query<any>(
    `SELECT COUNT(*)::int sample_count,
            COALESCE(AVG(ABS(fi.predicted_qty-fi.actual_qty)),0)::numeric mae,
            CASE WHEN SUM(fi.actual_qty)>0 THEN SUM(ABS(fi.predicted_qty-fi.actual_qty))/SUM(fi.actual_qty) ELSE NULL END AS wape,
            COALESCE(AVG(fi.predicted_qty-fi.actual_qty),0)::numeric bias,
            MIN(fr.generated_at) first_generated_at,MAX(fi.evaluated_at) last_evaluated_at
       FROM bms_inventory_forecast_items fi
       JOIN bms_inventory_forecast_runs fr ON fr.tenant_id=fi.tenant_id AND fr.id=fi.run_id
      WHERE fi.tenant_id=$1 AND fi.actual_qty IS NOT NULL AND fr.generated_at>=now()-make_interval(days=>$2)
        AND ($3::uuid IS NULL OR fi.location_id=$3)
        AND ($4::uuid[] IS NULL OR fi.location_id=ANY($4))`,
    [input.tenantId, days, locationId, allowed]
  );
  const row = result.rows[0] ?? {};
  return {
    method:METHOD,methodVersion:INVENTORY_INTELLIGENCE_METHOD_VERSION,windowDays:days,
    sampleCount:Number(row.sample_count ?? 0),mae:+Number(row.mae ?? 0).toFixed(3),
    wape:row.wape == null ? null : +Number(row.wape).toFixed(4),bias:+Number(row.bias ?? 0).toFixed(3),
    firstGeneratedAt:row.first_generated_at?.toISOString?.() ?? row.first_generated_at ?? null,
    lastEvaluatedAt:row.last_evaluated_at?.toISOString?.() ?? row.last_evaluated_at ?? null,
    disclaimer:"Accuracy is evidence from matured forecast snapshots; a small sample is not proof that future demand will match.",
  };
}

export async function runInventoryForecastMaintenancePage(afterTenant?: string | null, pageSize = 25) {
  const limit = boundedInt(pageSize, 1, 50, 25);
  const tenants = await query<{ id:string }>(
    `SELECT id FROM bms_tenants WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,
    [afterTenant?.trim() || null, limit + 1]
  );
  const page = tenants.rows.slice(0, limit);
  const results: Array<{tenantId:string;evaluated:number;snapshotItems:number;status:"OK"|"FAILED";error?:string}> = [];
  for (const tenant of page) {
    try {
      const evaluated = await evaluateDueInventoryForecasts(tenant.id);
      const snapshotItems = (await recordInventoryForecastSnapshot({
        tenantId:tenant.id,windowDays:30,coverageDays:30,horizonDays:30,
      })).itemCount;
      results.push({tenantId:tenant.id,evaluated,snapshotItems,status:"OK"});
    } catch (error) {
      results.push({tenantId:tenant.id,evaluated:0,snapshotItems:0,status:"FAILED",error:error instanceof Error ? error.message.slice(0,200) : "unknown"});
    }
  }
  return {processed:page.length,failed:results.filter((row)=>row.status==="FAILED").length,results,
    nextTenant:tenants.rows.length>limit ? page.at(-1)?.id ?? null : null};
}
