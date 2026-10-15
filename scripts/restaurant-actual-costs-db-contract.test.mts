import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {getClient,query} from '../apps/web/lib/db.ts';
import {beginTenantTx} from '../apps/web/lib/bms/tenant.ts';
import {confirmInventoryValue,inventoryValuation} from '../apps/web/lib/bms/inventoryValuation.ts';
import {createPurchaseOrder,receivePurchaseOrder} from '../apps/web/lib/bms/purchase.ts';
import {partiallyReturnPosSale} from '../apps/web/lib/bms/pos.ts';
import {recordInventoryWastage} from '../apps/web/lib/bms/wastage.ts';
import {createStockTransfer,sendStockTransfer,receiveStockTransfer} from '../apps/web/lib/bms/stockTransfers.ts';
import {getNetProfitReport} from '../apps/web/lib/bms/netProfit.ts';
import {getRestaurantMenuActual} from '../apps/web/lib/bms/restaurantMenuActual.ts';
import {upsertProductRecipe} from '../apps/web/lib/bms/productRecipes.ts';
import {previewPricePublication,publishPricePlan} from '../apps/web/lib/bms/restaurantPricePublishing.ts';
import {bmsRestaurantCostingResolvers} from '../apps/web/graphql/bmsRestaurantCosting.ts';
import {withCostingFixture,withAuditFailure,assertCostingTestDatabase} from './testing/restaurantCostingFixture.mts';
type Fixture=Parameters<Parameters<typeof withCostingFixture>[0]>[0];
const range=(f:Fixture)=>({from:`${f.month}-01`,to:new Date(Date.UTC(Number(f.month.slice(0,4)),Number(f.month.slice(5)),0)).toISOString().slice(0,10)});
async function opening(f:Fixture,sku:string,value='10000',location=f.location) {
  const row=(await inventoryValuation(f.tenant,f.actor,location)).rows.find(r=>r.sku===sku)!;
  const input={locationId:location,sku,size:'BASE',qty:row.qty,version:row.version,value,evidence:'FAKE verified purchase inventory',requestId:randomUUID(),confirmed:true};
  await confirmInventoryValue(f.tenant,f.actor,input);return input;
}
async function receive(f:Fixture,sku:string,qty:number,cost:number) {
  const po=await createPurchaseOrder({tenantId:f.tenant,items:[{sku,size:'BASE',qty,unitCost:cost}]});
  assert.equal(po.status,'CREATED');if(po.status!=='CREATED')throw new Error('PO failed');
  const result=await receivePurchaseOrder(f.tenant,po.poId,[{sku,size:'BASE',qty}],f.actor,f.actor,{locationId:f.location});
  assert.equal(result.status,'RECEIVED',JSON.stringify(result));
}
async function planFixture(f:Fixture) {
  await f.product('FAKE-RICE',10);await f.product('FAKE-MENU',20);
  await query("INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'RECIPE',true)",[f.tenant]);
  const zero={quantity:0,rate:0,source:'FAKE no usage'};
  const recipe=await upsertProductRecipe(f.tenant,{productSku:'FAKE-MENU',size:'BASE',outputQty:1,active:true,directItems:[{sku:'FAKE-RICE',size:'BASE',qty:2}],costAssumptions:{labor:zero,electricity:zero,gas:zero}},f.actor);
  return {plan:{recipeId:recipe.id,assumptionSource:'FAKE market price',dailyFixedCost:0,dailyTargetProfit:0,
    scenarios:[{label:'Retail',price:214,vatMode:'INCLUSIVE',vatPercent:7,gpPercent:0,gpBasis:'NET_REVENUE',extraUnitCost:0,expectedDailyUnits:1,targetMarginPercent:null}]},scenarioIndex:0,mode:'BASE',quantity:1};
}

test('actual costs: opening evidence is confirmed, stale-safe, idempotent, scoped and audited atomically',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');const input=await opening(f,'FAKE-A');
  assert.equal((await confirmInventoryValue(f.tenant,f.actor,input)).status,'SAVED');
  await assert.rejects(confirmInventoryValue(f.tenant,f.actor,{...input,value:'20000'}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(confirmInventoryValue(f.tenant,f.actor,{...input,confirmed:false}),/REVIEW_REQUIRED/);
  await assert.rejects(confirmInventoryValue(f.tenant,f.actor,{...input,requestId:randomUUID()}),/STALE_REVIEW/);
  await f.product('FAKE-B');
  await withAuditFailure(f.tenant,'inventory.value_opening',async()=>assert.rejects(opening(f,'FAKE-B'),/TEST_COST_AUDIT_FAILURE/));
  assert.equal((await inventoryValuation(f.tenant,f.actor,f.location)).rows.find(r=>r.sku==='FAKE-B')!.value,null);
  await query('INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)',[f.tenant,f.actor,f.locations[1]]);
  await assert.rejects(inventoryValuation(f.tenant,f.actor,f.location),/FORBIDDEN/);
}));

test('actual costs: purchase receipts update weighted average; sale freezes cost despite later catalog and purchase changes',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await opening(f,'FAKE-A');await receive(f,'FAKE-A',1000,30);
  const value=(await inventoryValuation(f.tenant,f.actor,f.location)).rows[0];
  assert.equal(value.qty,'2000');assert.equal(value.value,'40000.000000');assert.equal(value.unitCost,'20.000000');
  await f.sale('FAKE-A',2);await receive(f,'FAKE-A',2,100);
  await query('UPDATE bms_products SET cost_price=999 WHERE tenant_id=$1',[f.tenant]);
  const profit=await getNetProfitReport(f.tenant,f.actor,f.month,true);
  assert.equal(profit.totals.netCost,'40.00');assert.equal(profit.totals.netProfit,'160.00');
  const menu=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(menu.rows[0].cost,'40.00');assert.equal(menu.rows[0].revenue,'200.00');assert.equal(menu.rows[0].classification,'STAR');
}));

test('actual costs: unknown openings remain unknown after purchase, never fall back to catalog',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await receive(f,'FAKE-A',10,20);await f.sale('FAKE-A');
  assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month,true)).totals.netCost,null);
  const menu=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(menu.complete,false);assert.equal(menu.rows[0].classification,'UNCLASSIFIED');
}));

test('actual costs: partial return restores original value, deduplicates credit note/refund and replays once',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await opening(f,'FAKE-A');const sold=await f.sale('FAKE-A',3);
  await receive(f,'FAKE-A',100,100);
  const item=(await query('SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2',[f.tenant,sold.orderId])).rows[0];
  const input={tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,actorUserId:f.actor,approvedByUserId:f.approver,note:'[CUSTOMER_CHANGE] FAKE return',idempotencyKey:randomUUID(),lines:[{orderItemId:Number(item.id),packQty:1}]};
  assert.equal((await partiallyReturnPosSale(input)).status,'PARTIAL_RETURNED');
  assert.equal((await partiallyReturnPosSale(input)).status,'PARTIAL_RETURNED');
  const report=await getNetProfitReport(f.tenant,f.actor,f.month,true);
  assert.equal(report.totals.netCost,'20.00');assert.equal(report.totals.netRevenue,'200.00');assert.equal(report.totals.netProfit,'180.00');
  assert.equal(report.totals.refundCompleted,'107.00');
  const menu=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(menu.totalUnits,'2');assert.equal(menu.rows[0].cost,'20.00');assert.equal(menu.rows[0].revenue,'200.00');
  assert.equal((await query("SELECT count(*) AS n FROM bms_inventory_value_entries WHERE tenant_id=$1 AND kind='RETURN'",[f.tenant])).rows[0].n,'1');
}));

test('actual costs: transfer preserves value, loss is expensed once and wastage uses branch average',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await opening(f,'FAKE-A');await opening(f,'FAKE-A','50000',f.locations[1]);
  const transfer=await createStockTransfer({tenantId:f.tenant,fromLocationId:f.location,toLocationId:f.locations[1],items:[{sku:'FAKE-A',size:'BASE',qty:10}],createdBy:f.actor});
  assert.equal(transfer.status,'CREATED');if(transfer.status!=='CREATED')throw new Error('transfer');
  const id=transfer.transferId;
  assert.equal((await sendStockTransfer({tenantId:f.tenant,transferId:id,actorUserId:f.actor})).status,'OK');
  const line=(await query('SELECT id FROM bms_stock_transfer_items WHERE tenant_id=$1 AND transfer_id=$2',[f.tenant,id])).rows[0];
  const received=await receiveStockTransfer({tenantId:f.tenant,transferId:id,actorUserId:f.actor,received:[{itemId:Number(line.id),qty:8,reason:'LOST_IN_TRANSIT',note:'FAKE missing two'}]});
  assert.equal(received.status,'OK',JSON.stringify(received));
  const branch=(await inventoryValuation(f.tenant,f.actor,f.locations[1])).rows[0];assert.equal(branch.value,'50080.000000');
  await query("INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'WASTAGE',true)",[f.tenant]);
  await recordInventoryWastage({tenantId:f.tenant,locationId:f.location,productSku:'FAKE-A',size:'BASE',qty:3,reason:'FAKE loss',actorUserId:f.actor});
  const profit=await getNetProfitReport(f.tenant,f.actor,f.month,true);assert.equal(profit.totals.netCost,'50.00');assert.equal(profit.totals.netProfit,'-50.00');
}));

test('price publication: preview is read-only; confirmation publishes shared base price and replays once',async()=>withCostingFixture(async f=>{
  const input=await planFixture(f);const preview=await previewPricePublication(f.tenant,f.actor,input);
  assert.equal((await query('SELECT count(*) AS n FROM bms_price_plan_publications WHERE tenant_id=$1',[f.tenant])).rows[0].n,'0');
  const review={fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true};
  await publishPricePlan(f.tenant,f.actor,input,review);await publishPricePlan(f.tenant,f.actor,input,review);
  const pack=(await query('SELECT price,base_qty FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2 AND is_base',[f.tenant,'FAKE-MENU'])).rows[0];
  assert.equal(pack.price,'214.00');assert.equal(pack.base_qty,1);
  await f.sale('FAKE-MENU',1,f.location,214);
  assert.equal((await query("SELECT count(*) AS n FROM bms_audit_log WHERE tenant_id=$1 AND action='restaurant.price_plan_published'",[f.tenant])).rows[0].n,'1');
}));

test('price publication: changed costs, VAT mismatch, missing confirmation and audit failure cannot change real prices',async()=>withCostingFixture(async f=>{
  const input=await planFixture(f);let preview=await previewPricePublication(f.tenant,f.actor,input);
  await assert.rejects(publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:false}),/CONFIRM_REQUIRED/);
  await query("UPDATE bms_products SET cost_price=11 WHERE tenant_id=$1 AND sku='FAKE-RICE'",[f.tenant]);
  await assert.rejects(publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true}),/STALE_REVIEW/);
  preview=await previewPricePublication(f.tenant,f.actor,input);
  await withAuditFailure(f.tenant,'restaurant.price_plan_published',async()=>assert.rejects(publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true}),/TEST_COST_AUDIT_FAILURE/));
  assert.equal((await query('SELECT count(*) AS n FROM bms_price_plan_publications WHERE tenant_id=$1',[f.tenant])).rows[0].n,'0');
  await assert.rejects(previewPricePublication(f.tenant,f.actor,{...input,plan:{...input.plan,scenarios:[{...input.plan.scenarios[0],vatMode:'NONE',vatPercent:0}]}}),/VAT_MISMATCH/);
}));

test('price publication: same-menu packs and promotions use shared pricing writers',async()=>withCostingFixture(async f=>{
  const base=await planFixture(f);
  for(const mode of ['PACK','PROMOTION']) {
    const input={...base,mode,quantity:2,packCode:'SET2'};const preview=await previewPricePublication(f.tenant,f.actor,input);
    await publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true});
  }
  assert.equal((await query("SELECT price FROM bms_product_packs WHERE tenant_id=$1 AND pack_code='SET2'",[f.tenant])).rows[0].price,'428.00');
  assert.equal((await query('SELECT bundle_price FROM bms_product_promotions WHERE tenant_id=$1 AND active',[f.tenant])).rows[0].bundle_price,'428.00');
}));

test('actual costs: GraphQL permissions and database tenant grants isolate new features',async()=>withCostingFixture(async f=>{
  await assert.rejects(bmsRestaurantCostingResolvers.Mutation.bmsConfirmInventoryValue(null,{input:{locationId:f.location,sku:'X',size:'BASE',qty:'1',value:'1',version:'0',evidence:'x',requestId:randomUUID(),confirmed:true}},f.ctx('Customer')));
  const client=await getClient();try {
    await beginTenantTx(client,f.tenant);
    await assert.rejects(client.query('INSERT INTO bms_inventory_values(tenant_id,location_id,product_sku,size,qty,value) VALUES($1,$2,$3,$4,0,0)',[randomUUID(),f.location,'X','BASE']),/row-level security/);
    await client.query('ROLLBACK');await beginTenantTx(client,f.tenant);
    await assert.rejects(client.query('DELETE FROM bms_inventory_value_entries WHERE tenant_id=$1',[f.tenant]),/permission denied/);
    await client.query('ROLLBACK');
  } finally {client.release();}
}));

test('actual costs: concurrent receipt transactions serialize on the branch inventory row',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await opening(f,'FAKE-A');
  await Promise.all([receive(f,'FAKE-A',1000,20),receive(f,'FAKE-A',1000,30)]);
  const value=(await inventoryValuation(f.tenant,f.actor,f.location)).rows[0];
  assert.equal(value.qty,'3000');assert.equal(value.value,'60000.000000');assert.equal(value.unitCost,'20.000000');
}));

test('actual costs: cumulative partial returns conserve the final satang and never duplicate sale cost',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-A');await query('UPDATE bms_inventory SET current_stock=3 WHERE tenant_id=$1',[f.tenant]);
  await opening(f,'FAKE-A','0.01');const sold=await f.sale('FAKE-A',3);
  const item=(await query('SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2',[f.tenant,sold.orderId])).rows[0];
  for(let i=0;i<3;i++) {
    const r=await partiallyReturnPosSale({tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,actorUserId:f.actor,approvedByUserId:f.approver,note:'[CUSTOMER_CHANGE] FAKE fractional cost',idempotencyKey:randomUUID(),lines:[{orderItemId:Number(item.id),packQty:1}]});
    assert.equal(r.status,'PARTIAL_RETURNED',JSON.stringify(r));
  }
  const profit=await getNetProfitReport(f.tenant,f.actor,f.month,true);assert.equal(profit.totals.netCost,'0.00');
  const value=(await inventoryValuation(f.tenant,f.actor,f.location)).rows[0];assert.equal(value.value,'0.010000');
}));

test('actual costs schema: fresh install and reapplication retain RLS and append-only grants',async()=>{
  await assertCostingTestDatabase();
  const {readFileSync}=await import('node:fs');
  const client=await getClient();try {
    await client.query('BEGIN');
    await client.query('DROP TABLE bms_inventory_values,bms_inventory_value_entries,bms_inventory_value_openings,bms_price_plan_publications');
    for(let i=0;i<2;i++) {
      for(const file of ['10.67__bms_inventory_valuation','10.68__bms_price_plan_publications','10.69__bms_inventory_value_lifecycle']) {
        const sql=readFileSync(new URL(`../db/migrations/${file}.sql`,import.meta.url),'utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,'');
        await client.query(sql);
      }
      const rows=(await client.query(`SELECT relname,relrowsecurity,relforcerowsecurity,
        has_table_privilege('bms_app',oid,'INSERT') AS ins,has_table_privilege('bms_app',oid,'UPDATE') AS upd,
        has_table_privilege('bms_app',oid,'DELETE') AS del FROM pg_class
        WHERE relname IN ('bms_inventory_values','bms_inventory_value_entries','bms_inventory_value_openings','bms_price_plan_publications')`)).rows;
      assert.equal(rows.length,4);
      for(const row of rows) {assert.ok(row.relrowsecurity&&row.relforcerowsecurity&&row.ins);assert.equal(row.del,false);assert.equal(row.upd,row.relname==='bms_inventory_values');}
    }
  } finally {await client.query('ROLLBACK');client.release();}
});

test('actual menu: taxable, exempt and non-registered sales use frozen VAT buckets, never current registration',async()=>withCostingFixture(async f=>{
  await f.product('FAKE-V');await f.product('FAKE-N');
  await query("UPDATE bms_products SET vat_category='N' WHERE tenant_id=$1 AND sku='FAKE-N'",[f.tenant]);
  await opening(f,'FAKE-V');await opening(f,'FAKE-N');
  await f.sale('FAKE-V');await f.sale('FAKE-N');
  await query('UPDATE bms_store_profile SET vat_registered=false WHERE tenant_id=$1',[f.tenant]);
  await f.sale('FAKE-V');
  const report=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.rows.find(r=>r.sku==='FAKE-V')!.revenue,'207.00');
  assert.equal(report.rows.find(r=>r.sku==='FAKE-N')!.revenue,'107.00');
  await query("UPDATE bms_store_profile SET currency='USD' WHERE tenant_id=$1",[f.tenant]);
  await assert.rejects(inventoryValuation(f.tenant,f.actor,f.location),/CURRENCY_REVIEW_REQUIRED/);
}));

test('price publication: exempt products require a no-VAT scenario and unsupported currency is rejected',async()=>withCostingFixture(async f=>{
  const input=await planFixture(f);
  await query("UPDATE bms_products SET vat_category='N' WHERE tenant_id=$1 AND sku='FAKE-MENU'",[f.tenant]);
  const exempt={...input,plan:{...input.plan,scenarios:[{...input.plan.scenarios[0],vatMode:'NONE',vatPercent:0}]}};
  const preview=await previewPricePublication(f.tenant,f.actor,exempt);assert.equal(preview.status,'READY');
  await query("UPDATE bms_store_profile SET currency='USD' WHERE tenant_id=$1",[f.tenant]);
  await assert.rejects(previewPricePublication(f.tenant,f.actor,exempt),/CURRENCY_REVIEW_REQUIRED/);
}));

test('price publication: exclusive planning price converts to inclusive checkout exactly once',async()=>withCostingFixture(async f=>{
  const input=await planFixture(f);
  const exclusive={...input,plan:{...input.plan,scenarios:[{...input.plan.scenarios[0],price:100,vatMode:'EXCLUSIVE'}]}};
  const preview=await previewPricePublication(f.tenant,f.actor,exclusive);
  assert.equal(preview.snapshot.price,107);
  await publishPricePlan(f.tenant,f.actor,exclusive,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true});
  await opening(f,'FAKE-RICE');await f.sale('FAKE-MENU',1,f.location,107);
  const report=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.rows[0].revenue,'100.00');
  assert.equal(report.rows[0].cost,'20.00');
  assert.equal((await inventoryValuation(f.tenant,f.actor,f.location)).rows.find(r=>r.sku==='FAKE-RICE')!.qty,'998');
}));

test('price publication: unsupported exclusive checkout configuration cannot activate a plan',async()=>withCostingFixture(async f=>{
  const input=await planFixture(f);
  await query('UPDATE bms_store_profile SET price_includes_vat=false WHERE tenant_id=$1',[f.tenant]);
  await assert.rejects(previewPricePublication(f.tenant,f.actor,input),/EXCLUSIVE_CHECKOUT_UNSUPPORTED/);
}));

test('costing gaps: inventory search and server pages reach values beyond 1000 without guessing openings',async()=>withCostingFixture(async f=>{
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    SELECT $1,'PAGE-'||lpad(n::text,4,'0'),'FAKE page',107,true,'V' FROM generate_series(1,1007) n`,[f.tenant]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    SELECT $1,$2,sku,'BASE',1,0 FROM bms_products WHERE tenant_id=$1`,[f.tenant,f.location]);
  const page=await inventoryValuation(f.tenant,f.actor,f.location,{offset:1000,limit:50});
  assert.equal(page.total,1007);assert.equal(page.rows.length,7);assert.equal(page.rows[0].sku,'PAGE-1001');
  assert.ok(page.rows.every(r=>r.value===null));
  const found=await inventoryValuation(f.tenant,f.actor,f.location,{search:'PAGE-1007',limit:50});
  assert.equal(found.total,1);assert.equal(found.rows[0].sku,'PAGE-1007');
  assert.equal((await inventoryValuation(f.tenant,f.actor,f.location,{search:'%',limit:50})).rows.length,0);
  await assert.rejects(inventoryValuation(f.tenant,f.actor,f.location,{offset:-1}),/INVALID_PAGE/);
  await assert.rejects(inventoryValuation(f.tenant,f.actor,f.location,{limit:1001}),/INVALID_PAGE/);
}));

test('costing gaps: unsold active recipes remain visible without invalidating sold menu classification; selection recalculates population',async()=>withCostingFixture(async f=>{
  await planFixture(f);await f.product('FAKE-SOLD',10);await opening(f,'FAKE-SOLD');await f.sale('FAKE-SOLD',2);
  const report=await getRestaurantMenuActual(f.tenant,f.actor,range(f));
  assert.equal(report.complete,true);
  assert.equal(report.rows.find(r=>r.sku==='FAKE-MENU')?.classification,'NO_SALES');
  assert.equal(report.rows.find(r=>r.sku==='FAKE-SOLD')?.classification,'STAR');
  const selected=await getRestaurantMenuActual(f.tenant,f.actor,{...range(f),menuSkus:['FAKE-SOLD']});
  assert.equal(selected.rows.length,1);assert.equal(selected.totalUnits,'2');
}));

test('costing gaps: recipe and publication use branch weighted costs, refuse unknown stock and invalidate stale receipt reviews',async()=>withCostingFixture(async f=>{
  const {getRecipeCostEstimate}=await import('../apps/web/lib/bms/recipeCostEstimates.ts');
  const base=await planFixture(f),selection={costBasis:'WEIGHTED_AVERAGE' as const,locationId:f.location};
  const input={...base,plan:{...base.plan,...selection}};
  assert.equal((await getRecipeCostEstimate(f.tenant,base.plan.recipeId,undefined,selection,f.actor))?.status,'INCOMPLETE');
  await assert.rejects(previewPricePublication(f.tenant,f.actor,input),/COST_INCOMPLETE/);
  await opening(f,'FAKE-RICE');await receive(f,'FAKE-RICE',1000,30);
  const estimate=await getRecipeCostEstimate(f.tenant,base.plan.recipeId,undefined,selection,f.actor);
  assert.equal(estimate?.totalUnitCost,40);assert.equal(estimate?.ingredients[0].source,'MOVING_WEIGHTED_AVERAGE');
  assert.equal((await getRecipeCostEstimate(f.tenant,base.plan.recipeId))?.totalUnitCost,20);
  assert.equal((await getRecipeCostEstimate(f.tenant,base.plan.recipeId,undefined,{...selection,locationId:f.locations[1]},f.actor))?.status,'INCOMPLETE');
  const preview=await previewPricePublication(f.tenant,f.actor,input);
  await receive(f,'FAKE-RICE',1000,50);
  await assert.rejects(publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true}),/STALE_REVIEW/);
  await query('INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)',[f.tenant,f.approver,f.locations[1]]);
  await assert.rejects(getRecipeCostEstimate(f.tenant,base.plan.recipeId,undefined,selection,f.approver),/FORBIDDEN/);
}));

test('costing gaps: variant, branch, surface and schedule constrain actual promotion pricing and POS settlement',async()=>withCostingFixture(async f=>{
  const {resolvePosScan,recordPosSale}=await import('../apps/web/lib/bms/pos.ts');
  const {cartProductSubtotal}=await import('../packages/pos-client-core/src/cartPricing.ts');
  const base=await planFixture(f);
  await query("INSERT INTO bms_product_variants(tenant_id,product_sku,code,active) VALUES($1,'FAKE-MENU','L',true)",[f.tenant]);
  await query("INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES($1,$2,'FAKE-MENU','L',100,0)",[f.tenant,f.location]);
  await upsertProductRecipe(f.tenant,{productSku:'FAKE-MENU',size:'L',active:true,outputQty:1,directItems:[{sku:'FAKE-RICE',size:'BASE',qty:3}]},f.actor);
  const input={...base,mode:'PROMOTION',quantity:2,locationId:f.location,salesSurface:'RETAIL_POS',
    plan:{...base.plan,scenarios:[{...base.plan.scenarios[0],price:80.25}]}};
  const preview=await previewPricePublication(f.tenant,f.actor,input);
  await publishPricePlan(f.tenant,f.actor,input,{fingerprint:preview.fingerprint,requestId:randomUUID(),confirmed:true});
  const hit=await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location});
  assert.equal(hit?.promotion?.kind,'N_FOR_PRICE');
  const cart=(size:string)=>[{sku:'FAKE-MENU',size,packCode:'BASE',qty:2,baseQty:1,basePrice:107,packBasePrice:107,promotion:hit?.promotion}];
  assert.equal(cartProductSubtotal(cart('BASE')),160.5);assert.equal(cartProductSubtotal(cart('L')),214);
  assert.equal((await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.locations[1]}))?.promotion,null);
  assert.equal((await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location,surface:'RESTAURANT_POS'}))?.promotion,null);
  const reg=await f.register(f.location);
  const sale=await recordPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,cashierUserId:f.actor,idempotencyKey:randomUUID(),
    lines:[{sku:'FAKE-MENU',size:'BASE',packQty:2},{sku:'FAKE-MENU',size:'L',packQty:2}],payments:[{method:'CASH',amount:374.5,cashTendered:374.5}]});
  assert.equal(sale.status,'SOLD',JSON.stringify(sale));
  const scheduled={...input,startsAt:'2099-01-01T00:00:00Z',endsAt:'2099-02-01T00:00:00Z'};
  const future=await previewPricePublication(f.tenant,f.actor,scheduled);
  await publishPricePlan(f.tenant,f.actor,scheduled,{fingerprint:future.fingerprint,requestId:randomUUID(),confirmed:true});
  const stillCurrent=(await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location}))?.promotion;
  assert.ok(stillCurrent?.kind==='N_FOR_PRICE');
  assert.equal(stillCurrent.bundlePrice,160.5,'future publication preserves the currently effective offer');
  await assert.rejects(previewPricePublication(f.tenant,f.actor,{...scheduled,endsAt:'2098-01-01T00:00:00Z'}),/INVALID_SCOPE/);
  if (sale.status!=='SOLD' || typeof sale.orderId!=='string') throw new Error('Sale failed');
  const item=(await query("SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2 AND size='BASE'",[f.tenant,sale.orderId])).rows[0];
  const returned=await partiallyReturnPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,orderId:sale.orderId,
    actorUserId:f.actor,approvedByUserId:f.approver,note:'[CUSTOMER_CHANGE] FAKE variant return',idempotencyKey:randomUUID(),lines:[{orderItemId:Number(item.id),packQty:1}]});
  assert.equal(returned.status,'PARTIAL_RETURNED',JSON.stringify(returned));
  assert.equal((await query('SELECT refund_amount::text AS amount FROM bms_pos_returns WHERE tenant_id=$1 AND order_id=$2',[f.tenant,sale.orderId])).rows[0].amount,'53.50');
  await query('INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)',[f.tenant,f.approver,f.location]);
  assert.equal((await previewPricePublication(f.tenant,f.approver,{...input,quantity:1})).status,'READY');
  await assert.rejects(previewPricePublication(f.tenant,f.approver,{...input,locationId:f.locations[1]}),/FORBIDDEN/);
  await assert.rejects(previewPricePublication(f.tenant,f.approver,base),/ALL_BRANCH_ACCESS_REQUIRED/);

}));
