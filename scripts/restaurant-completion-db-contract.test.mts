import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {query,getClient} from '../apps/web/lib/db.ts';
import {beginTenantTx} from '../apps/web/lib/bms/tenant.ts';
import {withCostingFixture,withAuditFailure} from './testing/restaurantCostingFixture.mts';
import {upsertProductRecipe} from '../apps/web/lib/bms/productRecipes.ts';
import {previewPricePublication,publishPricePlan} from '../apps/web/lib/bms/restaurantPricePublishing.ts';
import {previewBundlePublication,publishMenuBundle} from '../apps/web/lib/bms/restaurantBundlePublishing.ts';
import {previewMenuProfit,confirmMenuProfit,getMenuProfit} from '../apps/web/lib/bms/restaurantMenuProfit.ts';
import {resolvePosScan,recordPosSale,partiallyReturnPosSale} from '../apps/web/lib/bms/pos.ts';
import {inventoryValuation,confirmInventoryValue} from '../apps/web/lib/bms/inventoryValuation.ts';
import {upsertProductPromotion} from '../apps/web/lib/bms/productPromotions.ts';
import {getOperatingCostReport,reviewOperatingCost} from '../apps/web/lib/bms/operatingCosts.ts';
import {bmsRestaurantCostingResolvers} from '../apps/web/graphql/bmsRestaurantCosting.ts';
import {checkStock} from '../apps/web/lib/bms/stock.ts';
import {listSellableProducts} from '../apps/web/lib/bms/products.ts';
type F=Parameters<Parameters<typeof withCostingFixture>[0]>[0];
const scenario=(price=214)=>({label:'FAKE',price,vatMode:'INCLUSIVE',vatPercent:7,gpPercent:0,gpBasis:'NET_REVENUE',extraUnitCost:0,expectedDailyUnits:1,targetMarginPercent:null});
const review=(fingerprint:string)=>({fingerprint,requestId:randomUUID(),confirmed:true});
async function opening(f:F,sku:string){const v=(await inventoryValuation(f.tenant,f.actor,f.location)).rows.find(r=>r.sku===sku)!;await confirmInventoryValue(f.tenant,f.actor,{locationId:f.location,sku,size:'BASE',qty:v.qty,version:v.version,value:'10000',evidence:'FAKE purchase proof',confirmed:true,requestId:randomUUID()});}
async function fixture(f:F){
 await f.product('FAKE-RICE',10);await f.product('FAKE-MENU',20);await f.product('FAKE-SECOND',30);
 await query("INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'RECIPE',true)",[f.tenant]);
 const zero={quantity:0,rate:0,source:'FAKE explicit no usage'};
 const recipes=[];for(const [sku,qty] of [['FAKE-MENU',2],['FAKE-SECOND',3]] as const)recipes.push(await upsertProductRecipe(f.tenant,{productSku:sku,size:'BASE',outputQty:1,active:true,directItems:[{sku:'FAKE-RICE',size:'BASE',qty}],costAssumptions:{labor:zero,electricity:zero,gas:zero}},f.actor));
 const input={plan:{recipeId:recipes[0].id,assumptionSource:'FAKE pricing evidence',dailyFixedCost:0,dailyTargetProfit:0,scenarios:[scenario()]},mode:'BASE',quantity:1,scenarioIndex:0};
 const p=await previewPricePublication(f.tenant,f.actor,input);await publishPricePlan(f.tenant,f.actor,input,review(p.fingerprint));
 return {input,recipes,bundle:{plan:{items:recipes.map((r,i)=>({recipeId:r.id,scenario:{...scenario(107),label:`FAKE ${i}`}})),assumptionSource:'FAKE bundle proof',dailyFixedCost:0,dailyTargetProfit:0,bundle:{scenario:scenario(160.5),parts:recipes.map(r=>({recipeId:r.id,qty:1}))}},sku:'FAKE-SET',name:'FAKE Menu Set',vatCategory:'V' as const,surfaces:['RETAIL_POS','RESTAURANT_POS'],kitchenStation:'FAKE Kitchen'}};
}
test('completion: branch base and pack prices can exceed shared prices, agree with POS and remain tenant scoped',async()=>withCostingFixture(async f=>{
 const {input}=await fixture(f);
 await query("UPDATE bms_product_packs SET pack_code='DISH' WHERE tenant_id=$1 AND product_sku='FAKE-MENU' AND is_base",[f.tenant]);
 const local={...input,locationId:f.location,plan:{...input.plan,scenarios:[scenario(321)]}};
 const p=await previewPricePublication(f.tenant,f.actor,local);await publishPricePlan(f.tenant,f.actor,local,review(p.fingerprint));
 assert.equal((await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location}))?.packPrice,321);
 assert.equal((await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.locations[1]}))?.packPrice,214);
 await query("INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled) SELECT $1,'FAKE-MENU',surface,true FROM unnest(ARRAY['CUSTOMER_AI','ONLINE_ORDER']) surface",[f.tenant]);
 const choices=await checkStock(f.tenant,'FAKE-MENU',null,f.location);assert.ok('sizes' in choices);assert.equal(choices.sizes?.find(r=>r.size==='BASE')?.price,321);
 const catalog=await listSellableProducts(f.tenant,{search:'FAKE-MENU',locationId:f.location,salesSurface:'RETAIL_POS'});assert.equal(catalog.items[0].price,321);
 await f.sale('FAKE-MENU',1,f.location,321);await f.sale('FAKE-MENU',1,f.locations[1],214);
 const globalPack={...input,mode:'PACK',quantity:2,packCode:'SET2'};let pr=await previewPricePublication(f.tenant,f.actor,globalPack);await publishPricePlan(f.tenant,f.actor,globalPack,review(pr.fingerprint));
 const pack={...globalPack,locationId:f.location,plan:{...input.plan,scenarios:[scenario(300)]}};pr=await previewPricePublication(f.tenant,f.actor,pack);await publishPricePlan(f.tenant,f.actor,pack,review(pr.fingerprint));
 assert.equal((await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',packCode:'SET2',locationId:f.location}))?.packPrice,600);
 const reg=await f.register();const sale=await recordPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,cashierUserId:f.actor,idempotencyKey:randomUUID(),lines:[{sku:'FAKE-MENU',size:'BASE',packCode:'SET2',packQty:1}],payments:[{method:'CASH',amount:600,cashTendered:600}]});assert.equal(sale.status,'SOLD');
 const c=await getClient();try{await beginTenantTx(c,randomUUID());assert.equal((await c.query('SELECT * FROM bms_branch_prices')).rowCount,0);await c.query('ROLLBACK');}finally{c.release();}
}));
test('completion: future promotion preserves today, switches at a half-open boundary and rejects overlapping windows',async()=>withCostingFixture(async f=>{
 const {input}=await fixture(f);
 await upsertProductPromotion({tenantId:f.tenant,actorUserId:f.actor,productSku:'FAKE-MENU',kind:'N_FOR_PRICE',buyQty:1,bundlePrice:100,locationId:f.location});
 const future={...input,mode:'PROMOTION',locationId:f.location,startsAt:'2099-01-01T00:00:00Z',endsAt:'2099-02-01T00:00:00Z',plan:{...input.plan,scenarios:[scenario(80)]}};
 const p=await previewPricePublication(f.tenant,f.actor,future);await publishPricePlan(f.tenant,f.actor,future,review(p.fingerprint));
 const current=(await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location}))?.promotion;assert.ok(current?.kind==='N_FOR_PRICE');assert.equal(current.bundlePrice,100);
 await f.sale('FAKE-MENU',1,f.location,100);
 for(const [time,price] of [['2098-12-31T23:59:59Z','100.00'],['2099-01-01T00:00:00Z','80.00']]) {const r=await query("SELECT bundle_price FROM bms_product_promotions WHERE tenant_id=$1 AND active AND tstzrange(starts_at,ends_at,'[)') @> $2::timestamptz",[f.tenant,time]);assert.equal(r.rowCount,1);assert.equal(r.rows[0].bundle_price,price);}
 await assert.rejects(upsertProductPromotion({tenantId:f.tenant,actorUserId:f.actor,productSku:'FAKE-MENU',kind:'N_FOR_PRICE',buyQty:1,bundlePrice:70,locationId:f.location,startsAt:'2098-12-01',endsAt:'2099-01-02'}),/SCHEDULE_OVERLAP/);
}));
test('completion: confirmed multi-menu publication creates a sellable pinned BOM and consumes real ingredients atomically',async()=>withCostingFixture(async f=>{
 const {bundle}=await fixture(f);await opening(f,'FAKE-RICE');
 const p=await previewBundlePublication(f.tenant,f.actor,bundle);assert.equal(p.snapshot.bom[0].qty,5);
 assert.equal((await query("SELECT 1 FROM bms_products WHERE tenant_id=$1 AND sku='FAKE-SET'",[f.tenant])).rowCount,0);
 const r=review(p.fingerprint);await publishMenuBundle(f.tenant,f.actor,bundle,r);await publishMenuBundle(f.tenant,f.actor,bundle,r);
 assert.equal((await resolvePosScan(f.tenant,'FAKE-SET',{size:'STD',locationId:f.location}))?.packPrice,160.5);
 const recipe=(await query("SELECT id FROM bms_product_recipes WHERE tenant_id=$1 AND product_sku='FAKE-SET' AND active",[f.tenant])).rows[0];
 const branch={plan:{recipeId:recipe.id,assumptionSource:'FAKE branch evidence',dailyFixedCost:0,dailyTargetProfit:0,scenarios:[scenario(321)]},mode:'BASE',quantity:1,scenarioIndex:0,locationId:f.location};
 const bp=await previewPricePublication(f.tenant,f.actor,branch);await publishPricePlan(f.tenant,f.actor,branch,review(bp.fingerprint));
 await query("DELETE FROM bms_inventory WHERE tenant_id=$1 AND product_sku='FAKE-SET' AND current_stock=0 AND reserved_stock=0",[f.tenant]);
 assert.equal((await query("SELECT 1 FROM bms_inventory WHERE tenant_id=$1 AND product_sku='FAKE-SET'",[f.tenant])).rowCount,0);
 const listed=await listSellableProducts(f.tenant,{search:'FAKE-SET',locationId:f.location,salesSurface:'RESTAURANT_POS',minPrice:300,maxPrice:350,inStockOnly:true});
 assert.equal(listed.items[0]?.price,321);assert.equal(listed.items[0]?.availableSizes[0]?.size,'STD');

 const reg=await f.register();const sale=await recordPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,cashierUserId:f.actor,idempotencyKey:randomUUID(),lines:[{sku:'FAKE-SET',size:'STD',packQty:1}],payments:[{method:'CASH',amount:321,cashTendered:321}]});assert.equal(sale.status,'SOLD',JSON.stringify(sale));
 assert.equal((await query("SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-RICE'",[f.tenant,f.location])).rows[0].current_stock,995);
 assert.equal((await query("SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND action='restaurant.bundle_published'",[f.tenant])).rows[0].n,1);

}));
test('completion: bundle unknown costs, stale previews, missing approval and audit failure cannot partially publish',async()=>withCostingFixture(async f=>{
 const {bundle}=await fixture(f);const p=await previewBundlePublication(f.tenant,f.actor,bundle);
 await assert.rejects(publishMenuBundle(f.tenant,f.actor,bundle,{...review(p.fingerprint),confirmed:false}),/CONFIRM_REQUIRED/);
 await withAuditFailure(f.tenant,'restaurant.bundle_published',()=>assert.rejects(publishMenuBundle(f.tenant,f.actor,bundle,review(p.fingerprint)),/TEST_COST_AUDIT_FAILURE/));
 assert.equal((await query("SELECT 1 FROM bms_products WHERE tenant_id=$1 AND sku='FAKE-SET'",[f.tenant])).rowCount,0);
 await query("UPDATE bms_products SET cost_price=11 WHERE tenant_id=$1 AND sku='FAKE-RICE'",[f.tenant]);
 await assert.rejects(publishMenuBundle(f.tenant,f.actor,bundle,review(p.fingerprint)),/STALE_REVIEW/);
 await assert.rejects(previewBundlePublication(f.tenant,f.actor,{...bundle,plan:{...bundle.plan,costBasis:'WEIGHTED_AVERAGE',locationId:f.location}}),/COST_INCOMPLETE/);
}));
test('completion: menu net profit allocates reviewed real expenses exactly, persists confirmation, and invalidates changed evidence',async()=>withCostingFixture(async f=>{
 await f.product('FAKE-A');await f.product('FAKE-B');await opening(f,'FAKE-A');await opening(f,'FAKE-B');await f.sale('FAKE-A',1);await f.sale('FAKE-B',2);
 const ex=await f.expense(10.01);const row=(await getOperatingCostReport(f.tenant,f.actor,f.month)).rows.find(r=>r.key===`DOCUMENT:${ex.id}`)!;
 await reviewOperatingCost(f.tenant,f.actor,{sourceKey:row.key,sourceFingerprint:row.fingerprint,expectedVersion:0,confirmed:true,disposition:'OPERATING',reason:'FAKE verified rent'});
 const input={month:f.month,method:'REVENUE',reason:'FAKE revenue allocation approved by owner'};
 const p=await previewMenuProfit(f.tenant,f.actor,input);assert.equal(p.snapshot.netProfit,'259.99');assert.equal(p.snapshot.rows[0].operating,'3.34');assert.equal(p.snapshot.rows[1].operating,'6.67');
 const r=review(p.fingerprint);await confirmMenuProfit(f.tenant,f.actor,input,r);await confirmMenuProfit(f.tenant,f.actor,input,r);assert.equal((await getMenuProfit(f.tenant,f.actor,{month:f.month})).status,'CURRENT');
 await f.sale('FAKE-A',1);assert.equal((await getMenuProfit(f.tenant,f.actor,{month:f.month})).status,'STALE');await assert.rejects(confirmMenuProfit(f.tenant,f.actor,input,review(p.fingerprint)),/STALE_REVIEW/);
}));
test('completion: menu profit fails closed for unknown opening, requires permission and rolls back failed audit',async()=>withCostingFixture(async f=>{
 await f.product('FAKE-A');await f.sale('FAKE-A');const input={month:f.month,method:'EQUAL',reason:'FAKE reviewed equal allocation'};
 await assert.rejects(previewMenuProfit(f.tenant,f.actor,input),/EVIDENCE_INCOMPLETE/);
 await assert.rejects(bmsRestaurantCostingResolvers.Mutation.bmsConfirmMenuNetProfit(null,{input,review:review('a'.repeat(64))},f.ctx('Customer')));
 // A separate month cannot gain historical costs merely by confirming opening inventory today.
 await opening(f,'FAKE-A');await assert.rejects(previewMenuProfit(f.tenant,f.actor,input),/EVIDENCE_INCOMPLETE/);
}));
test('completion: confirmed menu allocation audit is atomic and denied roles cannot publish bundles or branch prices',async()=>withCostingFixture(async f=>{
 await f.product('FAKE-A');await opening(f,'FAKE-A');await f.sale('FAKE-A');
 const input={month:f.month,method:'EQUAL',reason:'FAKE explicit allocation'},p=await previewMenuProfit(f.tenant,f.actor,input);
 await withAuditFailure(f.tenant,'report.menu_profit_confirmed',()=>assert.rejects(confirmMenuProfit(f.tenant,f.actor,input,review(p.fingerprint)),/TEST_COST_AUDIT_FAILURE/));
 assert.equal((await getMenuProfit(f.tenant,f.actor,{month:f.month})).status,'UNREVIEWED');
 const {bundle,input:priceInput}=await fixture(f);
 await assert.rejects(bmsRestaurantCostingResolvers.Mutation.bmsPublishMenuBundle(null,{input:bundle,review:review('a'.repeat(64))},f.ctx('Customer')));
 await query('INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)',[f.tenant,f.approver,f.location]);
 await assert.rejects(previewPricePublication(f.tenant,f.approver,{...priceInput,locationId:f.locations[1]}),/FORBIDDEN/);
 assert.equal((await previewPricePublication(f.tenant,f.approver,{...priceInput,locationId:f.location})).status,'READY');
 await assert.rejects(previewBundlePublication(f.tenant,f.approver,bundle),/ALL_BRANCH_ACCESS_REQUIRED/);
}));
test('completion: branch price returns use original sale amounts after branch overrides change',async()=>withCostingFixture(async f=>{
 const {input}=await fixture(f);const local={...input,locationId:f.location,plan:{...input.plan,scenarios:[scenario(321)]}};
 let p=await previewPricePublication(f.tenant,f.actor,local);await publishPricePlan(f.tenant,f.actor,local,review(p.fingerprint));
 const sale=await f.sale('FAKE-MENU',2,f.location,321);
 const next={...local,plan:{...input.plan,scenarios:[scenario(400)]}};p=await previewPricePublication(f.tenant,f.actor,next);await publishPricePlan(f.tenant,f.actor,next,review(p.fingerprint));
 const line=(await query('SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2',[f.tenant,sale.orderId])).rows[0];
 const returned=await partiallyReturnPosSale({tenantId:f.tenant,deviceId:sale.device,shiftId:sale.shift,orderId:sale.orderId,actorUserId:f.actor,approvedByUserId:f.approver,idempotencyKey:randomUUID(),note:'[CUSTOMER_CHANGE] FAKE return',lines:[{orderItemId:Number(line.id),packQty:1}]});
 assert.equal(returned.status,'PARTIAL_RETURNED');assert.equal((await query('SELECT refund_amount FROM bms_pos_returns WHERE tenant_id=$1',[f.tenant])).rows[0].refund_amount,'321.00');
}));

test('completion: shared native/desktop preview of branch price and scoped offer agrees with settlement',async()=>withCostingFixture(async f=>{
 const {cartProductSubtotal,normalizePromotion}=await import('../packages/pos-client-core/src/cartPricing.ts');
 const {input}=await fixture(f);
 const branch={...input,locationId:f.location,plan:{...input.plan,scenarios:[scenario(321)]}};
 const preview=await previewPricePublication(f.tenant,f.actor,branch);
 await publishPricePlan(f.tenant,f.actor,branch,review(preview.fingerprint));
 await upsertProductPromotion({tenantId:f.tenant,actorUserId:f.actor,productSku:'FAKE-MENU',kind:'N_FOR_PRICE',buyQty:2,bundlePrice:500,buySize:'BASE',locationId:f.location});
 const scan=await resolvePosScan(f.tenant,'FAKE-MENU',{size:'BASE',locationId:f.location,surface:'RETAIL_POS'});
 assert.ok(scan);
 assert.equal(scan.basePrice,321);
 const amount=cartProductSubtotal([{sku:scan.sku,size:scan.size,packCode:scan.packCode,qty:2,baseQty:scan.baseQty,
  basePrice:scan.basePrice,packBasePrice:scan.packPrice,priceTiers:scan.priceTiers,promotion:normalizePromotion(scan.promotion)}]);
 assert.equal(amount,500);
 const reg=await f.register();
 const sale=await recordPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,cashierUserId:f.actor,idempotencyKey:randomUUID(),
  lines:[{sku:scan.sku,size:scan.size,packCode:scan.packCode,packQty:2,baseQty:scan.baseQty}],payments:[{method:'CASH',amount,cashTendered:amount}]});
 assert.equal(sale.status,'SOLD',JSON.stringify(sale));
 assert.equal(sale.total,amount);
}));
