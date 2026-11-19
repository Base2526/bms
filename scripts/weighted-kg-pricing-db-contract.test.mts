import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {query,getClient} from "../apps/web/lib/db.ts";
import {beginTenantTx} from "../apps/web/lib/bms/tenant.ts";
import {recordMovement} from "../apps/web/lib/bms/movements.ts";
import {upsertProductStockPolicy} from "../apps/web/lib/bms/productStockPolicies.ts";
import {setProductSalesSurfaces} from "../apps/web/lib/bms/productConfiguration.ts";
import {upsertProduct} from "../apps/web/lib/bms/products.ts";
import {upsertStoreCapability} from "../apps/web/lib/bms/storeCapabilities.ts";
import {scaleBarcode} from "../apps/web/lib/bms/barcode.ts";
import {resolvePosScan} from "../apps/web/lib/bms/pos.ts";
import {createOrder,cancelOrder} from "../apps/web/lib/bms/orders.ts";
import {publishWeightedKgRate,weightedKgLineCents,parseWeightedKgRate} from "../apps/web/lib/bms/weightedKgPricing.ts";
import {priceRemainingLines} from "../apps/web/lib/bms/pricing.ts";

const sku=`FAKE-WEIGHT-${randomUUID().slice(0,8)}`;
const size="STD";
let scaleCode="";
let tenantId="",locationId="",actorId="",label750="",label500="";
const key=()=>`weighted-test-${randomUUID()}`;

test("exact satang calculation rounds per verified label",()=>{
  assert.equal(parseWeightedKgRate("23.45"),2345n);
  assert.equal(parseWeightedKgRate(23.45),null);
  assert.equal(parseWeightedKgRate("23.456"),null);
  assert.equal(weightedKgLineCents("2345",750),1759n);
  assert.equal(weightedKgLineCents("2345",500),1173n);
  assert.equal(weightedKgLineCents("2345",1250),2931n);
  assert.throws(()=>weightedKgLineCents("2345",0),/WEIGHTED_INVALID_GRAMS/);
});

test("setup weighted gram product on throwaway tenant",async()=>{
  const exists=await query<{reg:string|null}>(`SELECT to_regclass('bms_weighted_kg_prices')::text AS reg`);
  assert.equal(exists.rows[0]?.reg,"bms_weighted_kg_prices","apply 10.136 to throwaway DB");
  tenantId=(await query<{id:string}>(`SELECT id FROM bms_tenants WHERE id='11111111-1111-1111-1111-111111111111'`)).rows[0].id;
  actorId=(await query<{id:string}>(`SELECT id FROM users WHERE tenant_id=$1 ORDER BY id LIMIT 1`,[tenantId])).rows[0].id;
  locationId=(await query<{id:string}>(`SELECT id FROM bms_locations WHERE tenant_id=$1 AND active ORDER BY created_at LIMIT 1`,[tenantId])).rows[0].id;
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES($1,$2,'FAKE weighed sand',0.01,true,'V')`,[tenantId,sku]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
    VALUES($1,$2,'RETAIL_POS',true)`,[tenantId,sku]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    VALUES($1,$2,$3,$4,10000,0)`,[tenantId,locationId,sku,size]);
  const client=await getClient();
  try {await beginTenantTx(client,tenantId);await recordMovement(client,{tenantId,locationId,sku,size,
    type:"STOCK_IN",qty:10000,actor:"weighted-contract-fixture",note:"FAKE sand"});await client.query("COMMIT");}
  finally {client.release();}
  await query(`INSERT INTO bms_product_packs(tenant_id,product_sku,size,pack_code,unit_name,base_qty,price,is_base)
    VALUES($1,$2,$3,'BASE','กรัม',1,0.01,true)`,[tenantId,sku,size]);
  await upsertStoreCapability(tenantId,{capability:"WEIGHTED_PRODUCT",enabled:true});
  scaleCode=(await query<{code:string}>(`SELECT lpad(n::text,5,'0') AS code
    FROM generate_series(90000,99999) n WHERE NOT EXISTS
      (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id=$1
        AND scale_item_code=lpad(n::text,5,'0')) LIMIT 1`,[tenantId])).rows[0].code;
  await upsertProductStockPolicy(tenantId,{productSku:sku,stockPolicy:"WEIGHTED",baseUnit:"GRAM",
    displayUnit:"กก.",scaleItemCode:scaleCode,scaleSize:size});
  label750=scaleBarcode("WEIGHT",scaleCode,750);
  label500=scaleBarcode("WEIGHT",scaleCode,500);
});

test("publication is idempotent, tenant-bound and drives exact scan price",async()=>{
  const requestKey=key();
  const input={sku,size,rateBahtPerKg:"23.45",requestKey,confirmed:true};
  const first=await publishWeightedKgRate(tenantId,actorId,input);
  assert.equal(first.status,"PUBLISHED",JSON.stringify(first));
  assert.equal(first.revisionNo,1);
  assert.deepEqual(await publishWeightedKgRate(tenantId,actorId,input),first);
  assert.equal((await publishWeightedKgRate(tenantId,actorId,{...input,rateBahtPerKg:"24.00"})).status,
    "IDEMPOTENCY_CONFLICT");
  const hit=await resolvePosScan(tenantId,label750,{locationId});
  assert.equal(hit?.baseQty,750);
  assert.equal(hit?.packPrice,17.59);
  assert.deepEqual(hit?.priceTiers,[]);
  assert.equal(hit?.promotion,null);
  const foreign=await query<{id:string}>(`SELECT id FROM users WHERE tenant_id<>$1 LIMIT 1`,[tenantId]);
  if (foreign.rowCount) assert.equal((await publishWeightedKgRate(tenantId,foreign.rows[0].id,
    {...input,requestKey:key()})).status,"ACTOR_NOT_IN_TENANT");
  await assert.rejects(()=>setProductSalesSurfaces(tenantId,sku,["RETAIL_POS","ONLINE_ORDER"],actorId),
    /WEIGHTED_KG_ONLINE_SURFACE_NOT_SUPPORTED/);
  await assert.rejects(()=>setProductSalesSurfaces(tenantId,sku,["RETAIL_POS","RESTAURANT_POS"],actorId),
    /WEIGHTED_KG_ONLINE_SURFACE_NOT_SUPPORTED/);
  await assert.rejects(()=>upsertProduct(tenantId,{sku,name:"FAKE weighed sand",price:0.01,
    sales_surfaces:["RETAIL_POS","PUBLIC_STOREFRONT"]},actorId),
    /WEIGHTED_KG_ONLINE_SURFACE_NOT_SUPPORTED/);
  await assert.rejects(()=>upsertProductStockPolicy(tenantId,{productSku:sku,
    scaleItemCode:scaleCode==="90000"?"90001":"90000"},actorId),
    /WEIGHTED_KG_POLICY_LOCKED_UNTIL_RATE_WITHDRAWN/);
  const stillRetail=await query<{surface:string}>(`SELECT surface FROM bms_product_sales_surfaces
    WHERE tenant_id=$1 AND product_sku=$2 AND enabled`,[tenantId,sku]);
  assert.deepEqual(stillRetail.rows.map(row=>row.surface),["RETAIL_POS"]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
    VALUES($1,$2,'ONLINE_ORDER',true)`,[tenantId,sku]);
  assert.equal((await publishWeightedKgRate(tenantId,actorId,{...input,requestKey:key()})).status,
    "ONLINE_SURFACE_NOT_SUPPORTED");
  const web=await createOrder({tenantId,channel:"web",locationId,items:[{sku,size,qty:750,packCode:"BASE"}]});
  assert.equal(web.status,"INVALID_ITEM",JSON.stringify(web));
  await query(`UPDATE bms_product_sales_surfaces SET enabled=false WHERE tenant_id=$1
    AND product_sku=$2 AND surface='ONLINE_ORDER'`,[tenantId,sku]);
});

test("order freezes per-label total, stock grams and rate revision",async()=>{
  const original=await query<{reserved_stock:number}>(`SELECT reserved_stock FROM bms_inventory
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,[tenantId,locationId,sku,size]);
  const invalid=await createOrder({tenantId,channel:"pos",locationId,items:[{sku,size,qty:750,
    packCode:"BASE",verifiedScaleLabels:[{barcode:label500,copies:1}]}]});
  assert.equal(invalid.status,"INVALID_ITEM",JSON.stringify(invalid));
  const sale=await createOrder({tenantId,channel:"pos",locationId,items:[{sku,size,qty:1250,
    packCode:"BASE",packQty:1250,verifiedScaleLabels:[{barcode:label750,copies:1},{barcode:label500,copies:1}]}]});
  assert.equal(sale.status,"CREATED",JSON.stringify(sale));
  if(sale.status!=="CREATED") return;
  const line=(await query<{qty:number;line_amount:string;pricing_snapshot:any}>(
    `SELECT qty,line_amount,pricing_snapshot FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2`,
    [tenantId,sale.orderId])).rows[0];
  assert.equal(Number(line.line_amount),29.32);
  assert.equal(line.qty,1250);
  assert.equal(line.pricing_snapshot.weightedKg.rateCents,"2345");
  assert.equal(line.pricing_snapshot.weightedKg.basisGrams,1000);
  const reserved=await query<{reserved_stock:number}>(`SELECT reserved_stock FROM bms_inventory
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,[tenantId,locationId,sku,size]);
  assert.equal(Number(reserved.rows[0].reserved_stock)-Number(original.rows[0].reserved_stock),1250);
  const priced=priceRemainingLines([{id:1,sku,size,qty:1250,packQty:1250,returnedPackQty:0,
    receiptUnitPrice:0.02,packUnitPrice:null,pricingSnapshot:line.pricing_snapshot,lineAmount:29.32}],new Map([[1,500]]));
  assert.equal(priced.lines[0].amount,17.59);
  const changed=await publishWeightedKgRate(tenantId,actorId,{sku,size,rateBahtPerKg:"24.00",
    requestKey:key(),confirmed:true});
  assert.equal(changed.revisionNo,2);
  const old=(await query<{line_amount:string;pricing_snapshot:any}>(`SELECT line_amount,pricing_snapshot
    FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2`,[tenantId,sale.orderId])).rows[0];
  assert.equal(Number(old.line_amount),29.32);
  assert.equal(old.pricing_snapshot.weightedKg.rateCents,"2345");
  assert.equal((await resolvePosScan(tenantId,label750,{locationId}))?.packPrice,18);
  await cancelOrder(tenantId,sale.orderId);
});

test("weighted rate revisions obey tenant RLS and staff audit",async()=>{
  const client=await getClient();
  try {
    await beginTenantTx(client,tenantId);
    const own=await client.query(`SELECT rate_cents FROM bms_weighted_kg_prices WHERE tenant_id=$1
      AND product_sku=$2`,[tenantId,sku]);
    assert.equal(own.rows.length,2);
    const other=await client.query(`SELECT * FROM bms_weighted_kg_prices WHERE tenant_id=$1`,
      ["22222222-2222-2222-2222-222222222222"]);
    assert.equal(other.rows.length,0);
    await client.query("ROLLBACK");
  } finally {client.release();}
  const audit=await query<{n:number}>(`SELECT count(*)::int AS n FROM bms_audit_log
    WHERE tenant_id=$1 AND action='product.weighted_kg_price_published' AND target=$2`,[tenantId,sku]);
  assert.equal(audit.rows[0].n,2);
});

test("concurrent publications serialize without two current rates",async()=>{
  const [a,b]=await Promise.all([
    publishWeightedKgRate(tenantId,actorId,{sku,size,rateBahtPerKg:"25.00",requestKey:key(),confirmed:true}),
    publishWeightedKgRate(tenantId,actorId,{sku,size,rateBahtPerKg:"26.00",requestKey:key(),confirmed:true}),
  ]);
  assert.deepEqual([a.status,b.status],["PUBLISHED","PUBLISHED"]);
  assert.deepEqual([a.revisionNo,b.revisionNo].sort(),[3,4]);
  const current=await query<{revision_no:number;rate_cents:string}>(
    `SELECT revision_no,rate_cents::text FROM bms_weighted_kg_prices
      WHERE tenant_id=$1 AND product_sku=$2 AND size=$3 AND is_current`,[tenantId,sku,size]);
  assert.equal(current.rows.length,1);
  assert.equal(current.rows[0].revision_no,4);
});
