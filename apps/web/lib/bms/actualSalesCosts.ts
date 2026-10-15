import { parseCreditReason } from "./creditNoteMath";
import { readReturnFinancialSnapshot } from "./returnFinancialSnapshot";
import { evidenceCents } from "./salesEvidenceMath";
import type { PoolClient } from "pg";
import type { SalesEvidenceEvent } from "./salesEvidenceMath";

/** Enrich one bounded evidence page in the reader's transaction. No historical writes. */
export async function attachActualSalesCosts(client: PoolClient, tenant: string, events: SalesEvidenceEvent[]) {
  const orders = [...new Set(events.map(e=>e.orderId))];
  if (!orders.length) return;
  for (const event of events) if (event.kind==='TAX_ADJUSTMENT' && event.payload.docType==='CREDIT_NOTE') {
    const {returnRef}=parseCreditReason(event.payload.creditReason??'');
    if (!returnRef) continue;
    const row=(await client.query(`SELECT r.refund_amount::text AS amount,r.financial_snapshot,
      (SELECT count(*) FROM bms_tax_documents d WHERE d.tenant_id=r.tenant_id AND d.order_id=r.order_id
        AND d.doc_type='CREDIT_NOTE' AND d.cancelled_at IS NULL AND d.credit_reason LIKE '%['||r.id::text||']%') AS notes
      FROM bms_pos_returns r WHERE r.tenant_id=$1 AND r.id=$2 AND r.order_id=$3`,[tenant,returnRef,event.orderId])).rows[0];
    const snapshot=row ? readReturnFinancialSnapshot(row.financial_snapshot,row.amount) : null;
    if (row && Number(row.notes)===1 && snapshot?.tax && snapshot.issues.length===0
      && evidenceCents(row.amount)===evidenceCents(event.payload.amount)
      && evidenceCents(snapshot.tax.vat)===evidenceCents(event.payload.vat)) event.payload.reconciledReturn=true;
  }
  const costs = (await client.query<{item:string;kind:string;return_id:string|null;amount:string|null}>(`
    SELECT e.order_item_id::text AS item,e.kind,e.return_id,
      CASE WHEN bool_and(e.amount IS NOT NULL) AND
        (e.kind='RETURN' OR SUM(e.qty)=(SELECT SUM(l.qty) FROM bms_order_stock_lines l
          WHERE l.tenant_id=$1 AND l.order_item_id=e.order_item_id))
        THEN (CASE WHEN e.kind='RETURN' THEN
          round(SUM(e.amount)+COALESCE((SELECT SUM(prev.amount) FROM bms_inventory_value_entries prev
            WHERE prev.tenant_id=$1 AND prev.order_item_id=e.order_item_id AND prev.kind='RETURN'
              AND prev.movement_id<MIN(e.movement_id)),0),2)
          - round(COALESCE((SELECT SUM(prev.amount) FROM bms_inventory_value_entries prev
            WHERE prev.tenant_id=$1 AND prev.order_item_id=e.order_item_id AND prev.kind='RETURN'
              AND prev.movement_id<MIN(e.movement_id)),0),2)
          ELSE round(SUM(e.amount),2) END)::text END AS amount
    FROM bms_inventory_value_entries e WHERE e.tenant_id=$1 AND e.order_id=ANY($2::uuid[]) AND e.kind IN ('SHIP','RETURN')
    GROUP BY e.order_item_id,e.kind,e.return_id`,[tenant,orders])).rows;
  const map = new Map(costs.map(c=>[JSON.stringify([c.item,c.kind,c.return_id]),c.amount]));
  for (const event of events) {
    if (event.kind!=='SALE' && event.kind!=='RETURN') continue;
    event.payload.actualCostBasis = 'MOVING_WEIGHTED_AVERAGE';
    if (!Array.isArray(event.payload.lines)) continue;
    for (const line of event.payload.lines) line.actualCost = map.get(JSON.stringify([
      String(event.kind==='SALE' ? line.id : line.orderItemId),event.kind==='SALE' ? 'SHIP' : 'RETURN',
      event.kind==='SALE' ? null : event.key.slice('RETURN:'.length),
    ])) ?? null;
  }
}
