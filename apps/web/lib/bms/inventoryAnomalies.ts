import { query } from "@/lib/db";

export type InventoryAnomalyCode =
  | "RESERVATION_UNATTRIBUTED"
  | "RESERVATION_OVER_ATTRIBUTED"
  | "LOT_TOTAL_MISMATCH"
  | "STALE_TRANSFER"
  | "STALE_PURCHASE_ORDER"
  | "UNUSUAL_ADJUSTMENT"
  | "UNUSUAL_WASTAGE"
  | "UNUSUAL_TRANSFER_LOSS"
  | "MISSING_LOCATION_POLICY";

export type InventoryAnomaly = {
  code: InventoryAnomalyCode;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  locationId: string | null;
  locationName: string | null;
  sku: string | null;
  size: string | null;
  observedValue: number | null;
  expectedValue: number | null;
  threshold: string;
  evidence: Record<string, unknown>;
  detectedAt: string;
  deepLink: string;
  recommendedReview: string;
};

export async function getInventoryAnomalies(input: {
  tenantId: string;
  allowedLocationIds?: readonly string[] | null;
  includeTenantWide?: boolean;
  locationId?: string | null;
  limit?: number;
}): Promise<{ items: InventoryAnomaly[]; totalCount: number; truncated: boolean; verifiedAt: string }> {
  const allowed = input.allowedLocationIds ? [...input.allowedLocationIds] : null;
  const includeTenantWide = input.includeTenantWide ?? allowed === null;
  const locationId = input.locationId?.trim() || null;
  if (locationId && allowed && !allowed.includes(locationId)) throw new Error("ไม่มีสิทธิ์ดูสาขานี้");
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 100);
  const params = [input.tenantId, locationId, allowed];
  const [reservations, lots, transfers, purchaseOrders, movements, wastage, missingPolicies] = await Promise.all([
    query<any>(
      `WITH attributed AS (
         SELECT sl.location_id,sl.product_sku,sl.size,SUM(sl.qty)::int qty
           FROM bms_order_stock_lines sl JOIN bms_orders o ON o.tenant_id=sl.tenant_id AND o.id=sl.order_id
          WHERE sl.tenant_id=$1 AND o.status IN ('PENDING','PAID','PACKING')
          GROUP BY sl.location_id,sl.product_sku,sl.size
       )
       SELECT i.location_id,l.name location_name,i.product_sku sku,i.size,i.reserved_stock::int reserved,
              COALESCE(a.qty,0)::int attributed
         FROM bms_inventory i JOIN bms_locations l ON l.tenant_id=i.tenant_id AND l.id=i.location_id
         LEFT JOIN attributed a ON a.location_id=i.location_id AND a.product_sku=i.product_sku AND a.size=i.size
        WHERE i.tenant_id=$1 AND i.reserved_stock<>COALESCE(a.qty,0)
          AND ($2::uuid IS NULL OR i.location_id=$2) AND ($3::uuid[] IS NULL OR i.location_id=ANY($3))
        ORDER BY ABS(i.reserved_stock-COALESCE(a.qty,0)) DESC LIMIT 101`, params),
    query<any>(
      `SELECT i.location_id,l.name location_name,i.product_sku sku,i.size,i.current_stock::int current_stock,
              COALESCE(SUM(lot.qty),0)::int lot_stock
         FROM bms_inventory i JOIN bms_locations l ON l.tenant_id=i.tenant_id AND l.id=i.location_id
         JOIN bms_inventory_lots lot ON lot.tenant_id=i.tenant_id AND lot.location_id=i.location_id
          AND lot.product_sku=i.product_sku AND lot.size=i.size
        WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.location_id=$2)
          AND ($3::uuid[] IS NULL OR i.location_id=ANY($3))
        GROUP BY i.location_id,l.name,i.product_sku,i.size,i.current_stock
       HAVING i.current_stock<>COALESCE(SUM(lot.qty),0)
        ORDER BY ABS(i.current_stock-COALESCE(SUM(lot.qty),0)) DESC LIMIT 101`, params),
    query<any>(
      `SELECT t.id,t.from_location_id,t.to_location_id,lf.name from_name,lt.name to_name,
              EXTRACT(EPOCH FROM (now()-t.sent_at))/3600 age_hours
         FROM bms_stock_transfers t
         JOIN bms_locations lf ON lf.tenant_id=t.tenant_id AND lf.id=t.from_location_id
         JOIN bms_locations lt ON lt.tenant_id=t.tenant_id AND lt.id=t.to_location_id
        WHERE t.tenant_id=$1 AND t.status='IN_TRANSIT' AND t.sent_at<now()-interval '48 hours'
          AND ($2::uuid IS NULL OR t.from_location_id=$2 OR t.to_location_id=$2)
          AND ($3::uuid[] IS NULL OR t.from_location_id=ANY($3) OR t.to_location_id=ANY($3))
        ORDER BY t.sent_at LIMIT 101`, params),
    includeTenantWide ? query<any>(
      `SELECT po.id,po.created_at,EXTRACT(EPOCH FROM (now()-po.created_at))/86400 age_days,
              SUM(GREATEST(poi.qty_ordered-poi.qty_received,0))::int remaining
         FROM bms_purchase_orders po JOIN bms_purchase_order_items poi ON poi.tenant_id=po.tenant_id AND poi.po_id=po.id
        WHERE po.tenant_id=$1 AND po.status IN ('OPEN','PARTIAL') AND po.created_at<now()-interval '30 days'
        GROUP BY po.id,po.created_at ORDER BY po.created_at LIMIT 101`, [input.tenantId]) : Promise.resolve({ rows: [] }),
    query<any>(
      `SELECT m.location_id,l.name location_name,m.product_sku sku,m.size,m.type,
              SUM(ABS(m.qty))::int units,COUNT(*)::int events
         FROM bms_stock_movements m JOIN bms_locations l ON l.tenant_id=m.tenant_id AND l.id=m.location_id
        WHERE m.tenant_id=$1 AND m.created_at>=now()-interval '30 days'
          AND m.type IN ('COUNT_ADJUST','TRANSFER_LOST')
          AND ($2::uuid IS NULL OR m.location_id=$2) AND ($3::uuid[] IS NULL OR m.location_id=ANY($3))
        GROUP BY m.location_id,l.name,m.product_sku,m.size,m.type
       HAVING COUNT(*)>=3 OR SUM(ABS(m.qty))>=20 ORDER BY units DESC LIMIT 101`, params),
    query<any>(
      `SELECT w.location_id,l.name location_name,w.product_sku sku,w.size,SUM(w.qty)::int units,COUNT(*)::int events
         FROM bms_inventory_wastage w JOIN bms_locations l ON l.tenant_id=w.tenant_id AND l.id=w.location_id
        WHERE w.tenant_id=$1 AND w.created_at>=now()-interval '30 days'
          AND ($2::uuid IS NULL OR w.location_id=$2) AND ($3::uuid[] IS NULL OR w.location_id=ANY($3))
        GROUP BY w.location_id,l.name,w.product_sku,w.size
       HAVING COUNT(*)>=3 OR SUM(w.qty)>=20 ORDER BY units DESC LIMIT 101`, params),
    query<any>(
      `SELECT i.location_id,l.name location_name,i.product_sku sku,i.size
         FROM bms_inventory i JOIN bms_locations l ON l.tenant_id=i.tenant_id AND l.id=i.location_id
         LEFT JOIN bms_inventory_location_policies p ON p.tenant_id=i.tenant_id AND p.location_id=i.location_id
          AND p.product_sku=i.product_sku AND p.size=i.size
        WHERE i.tenant_id=$1 AND p.tenant_id IS NULL
          AND ($2::uuid IS NULL OR i.location_id=$2) AND ($3::uuid[] IS NULL OR i.location_id=ANY($3))
        ORDER BY l.name,i.product_sku,i.size LIMIT 101`, params),
  ]);

  const detectedAt = new Date().toISOString();
  const items: InventoryAnomaly[] = [];
  for (const row of reservations.rows) {
    const reserved = Number(row.reserved), attributed = Number(row.attributed);
    const over = attributed > reserved;
    items.push({ code: over ? "RESERVATION_OVER_ATTRIBUTED" : "RESERVATION_UNATTRIBUTED", severity: "CRITICAL",
      locationId: row.location_id, locationName: row.location_name, sku: row.sku, size: row.size,
      observedValue: reserved, expectedValue: attributed, threshold: "reserved_stock must equal active order stock lines",
      evidence: { reserved, attributed, difference: Math.abs(reserved-attributed) }, detectedAt,
      deepLink: `/admin/products?sku=${encodeURIComponent(row.sku)}`,
      recommendedReview: "ตรวจออร์เดอร์ที่ถือของ movement และ audit ก่อนปรับยอด" });
  }
  for (const row of lots.rows) items.push({ code:"LOT_TOTAL_MISMATCH",severity:"CRITICAL",locationId:row.location_id,locationName:row.location_name,sku:row.sku,size:row.size,
    observedValue:Number(row.lot_stock),expectedValue:Number(row.current_stock),threshold:"sum(lot.qty) must equal current_stock",
    evidence:{lotStock:Number(row.lot_stock),currentStock:Number(row.current_stock)},detectedAt,deepLink:`/admin/products?sku=${encodeURIComponent(row.sku)}`,
    recommendedReview:"หยุดใช้ตัวเลข expiry เพื่อสัญญาสต็อกจนกว่าจะ reconcile ล็อต"});
  for (const row of transfers.rows) items.push({ code:"STALE_TRANSFER",severity:"HIGH",locationId:row.to_location_id,locationName:row.to_name,sku:null,size:null,
    observedValue:+Number(row.age_hours).toFixed(1),expectedValue:48,threshold:"in transit for more than 48 hours",evidence:{transferId:row.id,from:row.from_name,to:row.to_name},detectedAt,
    deepLink:"/admin/stock-transfers",recommendedReview:"ตรวจสถานะการขนส่งและรับของที่สาขาปลายทาง"});
  for (const row of purchaseOrders.rows) items.push({ code:"STALE_PURCHASE_ORDER",severity:"HIGH",locationId:null,locationName:null,sku:null,size:null,
    observedValue:+Number(row.age_days).toFixed(1),expectedValue:30,threshold:"open or partial for more than 30 days",evidence:{purchaseOrderId:row.id,remainingUnits:Number(row.remaining)},detectedAt,
    deepLink:"/admin/purchase",recommendedReview:"ตรวจ lead time ผู้ขายและปิดหรืออัปเดต PO ที่ค้าง"});
  for (const row of movements.rows) items.push({ code:row.type==="TRANSFER_LOST"?"UNUSUAL_TRANSFER_LOSS":"UNUSUAL_ADJUSTMENT",severity:"HIGH",locationId:row.location_id,locationName:row.location_name,sku:row.sku,size:row.size,
    observedValue:Number(row.units),expectedValue:null,threshold:"at least 3 events or 20 units in 30 days",evidence:{events:Number(row.events),units:Number(row.units)},detectedAt,
    deepLink:"/admin/reports",recommendedReview:"ตรวจ movement และผู้อนุมัติเทียบกับการตรวจนับจริง"});
  for (const row of wastage.rows) items.push({ code:"UNUSUAL_WASTAGE",severity:"HIGH",locationId:row.location_id,locationName:row.location_name,sku:row.sku,size:row.size,
    observedValue:Number(row.units),expectedValue:null,threshold:"at least 3 events or 20 units in 30 days",evidence:{events:Number(row.events),units:Number(row.units)},detectedAt,
    deepLink:"/admin/wastage",recommendedReview:"ตรวจเหตุผลของเสีย lot และแนวโน้มซ้ำก่อนแก้ policy"});
  for (const row of missingPolicies.rows) items.push({ code:"MISSING_LOCATION_POLICY",severity:"MEDIUM",locationId:row.location_id,locationName:row.location_name,sku:row.sku,size:row.size,
    observedValue:null,expectedValue:null,threshold:"no branch override; tenant/default policy is used",evidence:{},detectedAt,
    deepLink:`/admin/products?sku=${encodeURIComponent(row.sku)}`,recommendedReview:"กำหนด safety stock และ lead time รายสาขาเมื่อค่าเริ่มต้นไม่เหมาะ"});
  items.sort((a,b)=>({CRITICAL:0,HIGH:1,MEDIUM:2}[a.severity]-({CRITICAL:0,HIGH:1,MEDIUM:2}[b.severity])));
  return { items:items.slice(0,limit),totalCount:items.length,truncated:items.length>limit,verifiedAt:detectedAt };
}
