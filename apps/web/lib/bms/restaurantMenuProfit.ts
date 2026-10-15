import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { normalizeProfitMonth, getNetProfitReport } from "./netProfit";
import { getRestaurantMenuActual } from "./restaurantMenuActual";
import { evidenceCents as cents, evidenceDecimal as money, allocateEvidenceAmount } from "./salesEvidenceMath";

export type MenuProfitInput={month:string;locationId?:string|null;method?:string;reason?:string;weights?:{sku:string;size:string;weight:number}[]};
type Review={fingerprint:string;requestId:string;confirmed:boolean};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function normalize(v:MenuProfitInput) {
  const month=normalizeProfitMonth(v.month),locationId=v.locationId??null,method=v.method??'REVENUE';
  if(locationId&&!/^[a-f0-9-]{36}$/i.test(locationId))throw new Error('MENU_PROFIT_INVALID_SCOPE');
  if(!['REVENUE','UNITS','EQUAL','WEIGHTED'].includes(method)||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>1000)throw new Error('MENU_PROFIT_RULE_REQUIRED');
  const weights=v.weights??[];
  if(!Array.isArray(weights)||weights.length>20000||weights.some(w=>typeof w.sku!=='string'||typeof w.size!=='string'||!Number.isSafeInteger(w.weight)||w.weight<0||w.weight>1000000))throw new Error('MENU_PROFIT_INVALID_WEIGHTS');
  const keys=weights.map(w=>JSON.stringify([w.sku,w.size]));if(new Set(keys).size!==keys.length)throw new Error('MENU_PROFIT_INVALID_WEIGHTS');
  return {month,locationId,method,reason:v.reason.trim(),weights:[...weights].sort((a,b)=>JSON.stringify([a.sku,a.size]).localeCompare(JSON.stringify([b.sku,b.size])))};
}
async function prepare(client:PoolClient,tenant:string,actor:string,input:MenuProfitInput) {
  const rule=normalize(input);
  // Existing all-source report enforces all-branch access and evidence completeness, in this transaction.
  const profit=await getNetProfitReport(tenant,actor,rule.month,true,client);
  const to=new Date(Date.UTC(Number(rule.month.slice(0,4)),Number(rule.month.slice(5,7)),0)).toISOString().slice(0,10);
  const menu=await getRestaurantMenuActual(tenant,actor,{from:`${rule.month}-01`,to,locationId:rule.locationId},client);
  const totals=rule.locationId?profit.branches.find(b=>b.locationId===rule.locationId):profit.totals;
  if(!totals?.complete||menu.truncated||menu.issues.length||!menu.rows.length||menu.rows.some(r=>r.revenue==null||r.cost==null))throw new Error('MENU_PROFIT_EVIDENCE_INCOMPLETE');
  const weights=menu.rows.map(r=>{
    if(rule.method==='EQUAL')return 1n;
    if(rule.method==='UNITS')return BigInt(r.units)>0n?BigInt(r.units):0n;
    if(rule.method==='REVENUE')return cents(r.revenue!)>0n?cents(r.revenue!):0n;
    const w=rule.weights.find(w=>w.sku===r.sku&&w.size===r.size);
    if(!w)throw new Error('MENU_PROFIT_INVALID_WEIGHTS');return BigInt(w.weight);
  });
  if(rule.method==='WEIGHTED'&&rule.weights.length!==menu.rows.length)throw new Error('MENU_PROFIT_INVALID_WEIGHTS');
  if(weights.reduce((a,b)=>a+b,0n)===0n)throw new Error('MENU_PROFIT_ZERO_WEIGHT');
  const split=(v:string)=>{const n=cents(v),sign=n<0n?-1n:1n;return allocateEvidenceAmount(n*sign,weights).map(a=>a*sign);};
  const operating=split(totals.knownOperatingExpense),gp=split(totals.knownGpExpense),depreciation=split(totals.knownDepreciationExpense);
  const materialCost=menu.rows.reduce((a,r)=>a+cents(r.cost!),0n);
  const inventory=split(money(cents(totals.netCost!)-materialCost));
  const rows=menu.rows.map((r,i)=>({...r,allocationWeight:String(weights[i]),operating:money(operating[i]),gp:money(gp[i]),depreciation:money(depreciation[i]),inventoryAdjustment:money(inventory[i]),
    netProfit:money(cents(r.revenue!)-cents(r.cost!)-operating[i]-gp[i]-depreciation[i]-inventory[i])}));
  const menuProfit=rows.reduce((a,r)=>a+cents(r.netProfit),0n);
  const nonMenuRevenue=money(cents(totals.netRevenue!)-rows.reduce((a,r)=>a+cents(r.revenue!),0n));
  if(menuProfit+cents(nonMenuRevenue)!==cents(totals.netProfit!))throw new Error('MENU_PROFIT_RECONCILIATION_FAILED');
  const snapshot={rule,rows,totals,menuNetProfit:money(menuProfit),nonMenuRevenue,netProfit:totals.netProfit,basis:'REVIEWED_EXPENSES_AND_ACTUAL_MATERIAL_COST_PRE_INCOME_TAX'};
  return {snapshot,fingerprint:hash(snapshot)};
}
async function tx<T>(tenant:string,actor:string,write:boolean,work:(c:PoolClient)=>Promise<T>) {
  const c=await getClient();try{await beginTenantTx(c,tenant,{serializable:true,...write?{editorId:actor}:{}});const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function previewMenuProfit(tenant:string,actor:string,input:MenuProfitInput) {
  return tx(tenant,actor,false,async c=>({status:'READY',...await prepare(c,tenant,actor,input)}));
}
export async function confirmMenuProfit(tenant:string,actor:string,input:MenuProfitInput,review:Review) {
  if(review.confirmed!==true||!/^[a-f0-9]{64}$/.test(review.fingerprint)||!/^[a-f0-9-]{36}$/i.test(review.requestId))throw new Error('MENU_PROFIT_CONFIRM_REQUIRED');
  return tx(tenant,actor,true,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1072))',[tenant]);
    // Scope is checked even on retries.
    const scoped=await c.query('SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 LIMIT 1',[tenant,actor]);
    if(scoped.rowCount)throw new Error('MENU_PROFIT_ALL_BRANCH_ACCESS_REQUIRED');
    const rule=normalize(input),requestHash=hash({rule,fingerprint:review.fingerprint});
    const old=(await c.query('SELECT request_hash FROM bms_menu_profit_allocations WHERE tenant_id=$1 AND request_id=$2',[tenant,review.requestId])).rows[0];
    if(old){if(old.request_hash!==requestHash)throw new Error('MENU_PROFIT_IDEMPOTENCY_CONFLICT');return {status:'SAVED'};}
    const p=await prepare(c,tenant,actor,input);if(p.fingerprint!==review.fingerprint)throw new Error('MENU_PROFIT_STALE_REVIEW');
    const scope=rule.locationId??'ALL';
    await c.query(`INSERT INTO bms_menu_profit_allocations(tenant_id,month,scope,version,request_id,request_hash,snapshot,created_by)
      SELECT $1,$2,$3,COALESCE(max(version),0)+1,$4,$5,$6::jsonb,$7 FROM bms_menu_profit_allocations WHERE tenant_id=$1 AND month=$2 AND scope=$3`,[tenant,rule.month,scope,review.requestId,requestHash,JSON.stringify(p),actor]);
    await c.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'report.menu_profit_confirmed',$3,$4::jsonb)`,[tenant,actor,review.requestId,JSON.stringify({month:rule.month,scope,fingerprint:p.fingerprint,method:rule.method})]);
    return {status:'SAVED'};
  });
}
export async function getMenuProfit(tenant:string,actor:string,input:{month:string;locationId?:string|null}) {
  return tx(tenant,actor,false,async c=>{
    const scoped=await c.query('SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 LIMIT 1',[tenant,actor]);
    if(scoped.rowCount)throw new Error('MENU_PROFIT_ALL_BRANCH_ACCESS_REQUIRED');
    const month=normalizeProfitMonth(input.month),scope=input.locationId??'ALL';
    const saved=(await c.query('SELECT snapshot,version FROM bms_menu_profit_allocations WHERE tenant_id=$1 AND month=$2 AND scope=$3 ORDER BY version DESC LIMIT 1',[tenant,month,scope])).rows[0];
    if(!saved)return {status:'UNREVIEWED'};
    try {const p=await prepare(c,tenant,actor,saved.snapshot.snapshot.rule);return p.fingerprint===saved.snapshot.fingerprint?{status:'CURRENT',...p}:{status:'STALE'};}
    catch(e){if(e instanceof Error&&e.message.startsWith('MENU_PROFIT_'))return {status:'STALE',errorCode:e.message};throw e;}
  });
}
