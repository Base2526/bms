import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { scanSalesEvidenceInTx } from "./salesEvidence";
import { createMenuPerformanceAccumulator } from "./restaurantMenuPerformance";
import { inspectSalesEvidence, evidenceCents as cents, evidenceDecimal as money, allocateEvidenceAmount } from "./salesEvidenceMath";
import { readReturnFinancialSnapshot } from "./returnFinancialSnapshot";

/** Menu engineering from posted sales and returns. Cash refunds do not reduce sales a second time. */
export async function getRestaurantMenuActual(tenant: string, actor: string, filter: unknown, transaction?: PoolClient) {
  if (!filter || typeof filter!=="object" || Array.isArray(filter)) throw new Error("SALES_EVIDENCE_INVALID_INPUT");
  const client = transaction ?? await getClient(), menu = createMenuPerformanceAccumulator(), issues = new Set<string>();
  let incomplete = false;
  try {
    if (!transaction) await beginTenantTx(client,tenant,{serializable:true});
    const catalog = (await client.query(`SELECT DISTINCT product_sku AS sku,size FROM bms_product_recipes
      WHERE tenant_id=$1 AND active ORDER BY product_sku,size LIMIT 20001`,[tenant])).rows;
    if (catalog.length>20000) { incomplete=true; issues.add("MENU_POPULATION_TRUNCATED"); }
    const selected = (filter as {menuSkus?:string[]}|null)?.menuSkus;
    if (selected != null && (!Array.isArray(selected) || !selected.length || selected.length>200 || selected.some(s=>typeof s!=="string" || !s || s.length>100))) throw new Error("SALES_EVIDENCE_INVALID_MENU_SELECTION");
    const population = new Set(catalog.slice(0,20000).filter(r=>!selected||selected.includes(r.sku)).map(r=>JSON.stringify([r.sku,r.size])));
    for (const key of population) { const [sku,size]=JSON.parse(key); menu.add({sku,size,units:"0",revenue:"0",cost:"0"}); }
    const {menuSkus: _selection,...salesFilter} = filter as Record<string,unknown>;
    const scan = await scanSalesEvidenceInTx(client,tenant,actor,salesFilter,event=> {
      if (event.kind==='REFUND' || (event.kind==='TAX_ADJUSTMENT' && event.payload.reconciledReturn===true)) return;
      if (event.kind!=='SALE' && event.kind!=='RETURN') {
        incomplete=true; issues.add(`${event.kind}_REQUIRES_RECONCILIATION`); return;
      }
      const checked = inspectSalesEvidence(event), p=event.payload;
      const financialIssues=checked.issues.filter(c=>!['MISSING_COST','INVALID_COST_SOURCE','LEGACY_RECONSTRUCTED_COST',
        'RETURN_COST_IS_QUANTITY_BASIS','RETURN_VAT_IS_SALE_ALLOCATION','RESERVATION_RELEASE_NOT_RESTOCK'].includes(c));
      if (financialIssues.length) { incomplete=true; for (const c of financialIssues) issues.add(c); }
      if (!Array.isArray(p.lines) || p.lines.length>1000) { incomplete=true; return; }
      const sale = event.kind==='SALE';
      const snapshot = sale ? null : readReturnFinancialSnapshot(p.financialSnapshot,p.amount);
      const taxable = sale ? cents(p.taxable) : snapshot?.tax ? cents(snapshot.tax.taxableGross) : null;
      const vat = sale ? cents(p.vat) : snapshot?.tax ? cents(snapshot.tax.vat) : null;
      const gross = p.lines.map((line: {id:string;orderItemId?:string;amount:string}) => sale
        ? checked.attribution.find(a=>a.itemId===line.id)?.netAmount ?? null : line.amount);
      const weights: bigint[] = p.lines.map((line: {vatCategory?:string},i:number)=>taxable!==0n && line.vatCategory==='V' && gross[i]!=null ? cents(gross[i]) : 0n);
      const merchandiseTaxable=weights.reduce((a,b)=>a+b,0n);
      const valid = financialIssues.length===0 && taxable!=null && vat!=null && taxable>=merchandiseTaxable
        && vat<=taxable && gross.every((v:string|null)=>v!=null)
        && p.lines.every((line:{vatCategory?:string})=>taxable===0n || line.vatCategory==='V'||line.vatCategory==='N');
      const taxes = valid ? allocateEvidenceAmount(vat!,[...weights,taxable!-merchandiseTaxable]) : null;
      if (!valid) { incomplete=true; issues.add('MENU_LINE_VAT_UNRECONCILED'); }
      p.lines.forEach((line:{sku:string;size:string;qty:string;actualCost:string|null},i:number)=> {
        if (selected && !selected.includes(line.sku)) return;
        if (line.actualCost==null) issues.add('ACTUAL_INVENTORY_COST_UNKNOWN');
        menu.add({sku:line.sku,size:line.size,units:`${sale?'':'-'}${line.qty}`,
          revenue:taxes ? money((cents(gross[i])-taxes[i])*(sale?1n:-1n)) : null,
          cost:line.actualCost==null ? null : money(cents(line.actualCost)*(sale?1n:-1n))});
      });
    },true);
    const result = menu.finish(incomplete||scan.truncated);
    if (!transaction) await client.query("COMMIT");
    return {status:"OK",...scan,...result,issues:[...issues].sort(),
      basis:"POSTED_SALES_RETURNS_EX_VAT",costBasis:"MOVING_WEIGHTED_AVERAGE",classificationBasis:"70_PERCENT_EQUAL_SHARE_AND_WEIGHTED_UNIT_CONTRIBUTION"};
  } catch(e) { if (!transaction) await client.query("ROLLBACK"); throw e; } finally { if (!transaction) client.release(); }
}
