import { readInventoryEvidence } from "./inventoryEvidenceRead";

export async function getSupplierIntelligence(input:{tenantId:string;supplierId?:string|null;days?:number;limit?:number}) {
  const days=Math.min(Math.max(Math.floor(input.days??180),30),730);
  const limit=Math.min(Math.max(Math.floor(input.limit??25),1),100);
  const result=await readInventoryEvidence(input.tenantId, (client) => client.query<any>(
    `WITH line_history AS (
       SELECT po.supplier_id,poi.product_sku,poi.size,po.created_at,poi.unit_cost,
              LAG(poi.unit_cost) OVER(PARTITION BY po.supplier_id,poi.product_sku,poi.size ORDER BY po.created_at,poi.id) previous_cost
         FROM bms_purchase_orders po JOIN bms_purchase_order_items poi ON poi.tenant_id=po.tenant_id AND poi.po_id=po.id
        WHERE po.tenant_id=$1 AND po.supplier_id IS NOT NULL AND po.created_at>=now()-make_interval(days=>$3)
     ), cost_changes AS (
       SELECT supplier_id,AVG(ABS(unit_cost-previous_cost)/NULLIF(previous_cost,0)*100) avg_cost_change_pct
         FROM line_history WHERE previous_cost IS NOT NULL GROUP BY supplier_id
     ), po_rows AS (
       SELECT po.id,po.supplier_id,po.status,po.created_at,po.updated_at,
              COALESCE(SUM(poi.qty_received),0)::numeric received_units,COALESCE(SUM(poi.qty_ordered),0)::numeric ordered_units
         FROM bms_purchase_orders po LEFT JOIN bms_purchase_order_items poi ON poi.tenant_id=po.tenant_id AND poi.po_id=po.id
        WHERE po.tenant_id=$1 AND po.created_at>=now()-make_interval(days=>$3)
        GROUP BY po.id,po.supplier_id,po.status,po.created_at,po.updated_at
     ), po_metrics AS (
       SELECT supplier_id,COUNT(*)::int po_count,COUNT(*) FILTER(WHERE status='RECEIVED')::int received_count,
              COUNT(*) FILTER(WHERE status='CANCELLED')::int cancelled_count,SUM(received_units) received_units,SUM(ordered_units) ordered_units,
              AVG(EXTRACT(EPOCH FROM (updated_at-created_at))/86400) FILTER(WHERE status='RECEIVED') avg_lead_days,
              MAX(created_at) last_order_at FROM po_rows GROUP BY supplier_id
     ), mapped AS (
       SELECT supplier_id,COUNT(*) FILTER(WHERE active)::int mapped_products
         FROM bms_supplier_products WHERE tenant_id=$1 GROUP BY supplier_id
     )
     SELECT s.id,s.name,COALESCE(pm.po_count,0)::int po_count,COALESCE(pm.received_count,0)::int received_count,
            COALESCE(pm.cancelled_count,0)::int cancelled_count,
            CASE WHEN pm.ordered_units>0 THEN pm.received_units/pm.ordered_units ELSE NULL END fill_rate,
            pm.avg_lead_days,cc.avg_cost_change_pct,COALESCE(m.mapped_products,0)::int mapped_products,pm.last_order_at
       FROM bms_suppliers s LEFT JOIN po_metrics pm ON pm.supplier_id=s.id
       LEFT JOIN cost_changes cc ON cc.supplier_id=s.id LEFT JOIN mapped m ON m.supplier_id=s.id
      WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.id=$2)
      ORDER BY pm.last_order_at DESC NULLS LAST,s.name LIMIT $4`,
    [input.tenantId,input.supplierId?.trim()||null,days,limit]
  ));
  const items=result.rows.map((row:any)=>{
    const fillRate=row.fill_rate==null?null:+Number(row.fill_rate).toFixed(4);
    const avgLeadDays=row.avg_lead_days==null?null:+Number(row.avg_lead_days).toFixed(1);
    const avgCostChangePct=row.avg_cost_change_pct==null?null:+Number(row.avg_cost_change_pct).toFixed(1);
    const evidenceCount=Number(row.po_count);
    const classification=evidenceCount<3?"INSUFFICIENT_DATA":fillRate!=null&&fillRate<0.8?"REVIEW_FILL_RATE":avgCostChangePct!=null&&avgCostChangePct>15?"REVIEW_COST_VOLATILITY":"STABLE_HISTORY";
    return {supplierId:String(row.id),supplierName:String(row.name),poCount:evidenceCount,receivedCount:Number(row.received_count),
      cancelledCount:Number(row.cancelled_count),fillRate,avgLeadDays,avgCostChangePct,mappedProductCount:Number(row.mapped_products),
      lastOrderAt:row.last_order_at?.toISOString?.()??row.last_order_at??null,classification};
  });
  return {windowDays:days,generatedAt:new Date().toISOString(),items,disclaimer:"Derived from recorded PO quantities and comparable supplier-product costs. avgLeadDays is a proxy from creation to last update of received POs, not a verified delivery duration. Fill rate includes open and cancelled POs; it is not an on-time delivery rate."};
}
