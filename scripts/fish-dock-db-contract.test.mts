import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query } from "../apps/web/lib/db.ts";
import { fishIntakeOptions, getFishIntake, listFishIntakes, saveFishIntake, FishIntakeError } from "../apps/web/lib/bms/fishIntake.ts";
import { getFishOwnerSnapshot } from "../apps/web/lib/bms/fishOwnerRead.ts";
import { saveFishStorageCount, FishOwnerError } from "../apps/web/lib/bms/fishOwnerOperations.ts";
import { createFishDeliveryPlan, attachFishDeliveryOrder } from "../apps/web/lib/bms/fishOwnerOperations.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { assertCostingTestDatabase } from "./testing/restaurantCostingFixture.mts";

// Writes only to the disposable restored database on localhost:5433. Like the
// other DB contracts, the uniquely named FAKE fixture remains for inspection.
let tenant: string, otherTenant: string, location: string, otherLocation: string, actor: string;
const sku="FAKE-FISH-WEIGHTED";
test.before(async () => {
  await assertCostingTestDatabase();
  tenant=randomUUID(); otherTenant=randomUUID();
  for (const id of [tenant,otherTenant]) {
    await query(`INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE fish dock contract',$2)`,[id,`fake-fish-${id}`]);
    await query(`INSERT INTO bms_store_profile(tenant_id,currency,vat_registered) VALUES($1,'THB',false)`,[id]);
    await query(`INSERT INTO bms_store_capabilities(tenant_id,capability,enabled,source)
      VALUES($1,'WEIGHTED_PRODUCT',true,'MANUAL')`,[id]);
  }
  location=(await query(`INSERT INTO bms_locations(tenant_id,code,name,branch_code,is_head_office)
    VALUES($1,'MAIN','FAKE fish branch','00000',true) RETURNING id`,[tenant])).rows[0].id;
  otherLocation=(await query(`INSERT INTO bms_locations(tenant_id,code,name,branch_code,is_head_office)
    VALUES($1,'OTHER','FAKE restricted branch','00001',false) RETURNING id`,[tenant])).rows[0].id;
  actor=(await query(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
    SELECT 'FAKE fish actor',$2,$2,'Administrator',id,$1,'x',true FROM roles
    WHERE name='Administrator' ORDER BY id LIMIT 1 RETURNING id`,[tenant,`fish-${tenant}@example.invalid`])).rows[0].id;
  await query(`INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,[tenant,actor,location]);
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES($1,$2,'FAKE weighted fish',0.05,true,'V')`,[tenant,sku]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface)
    VALUES($1,$2,'RETAIL_POS')`,[tenant,sku]);
  await query(`INSERT INTO bms_product_variants(tenant_id,product_sku,code)
    VALUES($1,$2,'L')`,[tenant,sku]);
  await query(`INSERT INTO bms_product_stock_policies
    (tenant_id,product_sku,stock_policy,base_unit,display_unit,display_precision,lot_tracking)
    VALUES($1,$2,'WEIGHTED','GRAM','kg',3,true)`,[tenant,sku]);
});

test("history is evidence only, while live receipt atomically adds grams, lot, movement and reviewed value",async()=>{
  const history={kind:"HISTORICAL" as const,requestKey:randomUUID(),sourceName:"FAKE.xlsx",sourceSheet:"daily",sourceYear:2025,
    lines:[{sourceRow:3,fishName:"FAKE fish",billDate:"2025-01-01",receivedDate:"2025-01-01",
      billKg:"4.000",receivedKg:"3.900",purchaseAmount:"150.00"}]};
  const savedHistory=await saveFishIntake(tenant,actor,history);
  assert.equal(savedHistory.status,"SAVED");
  assert.equal((await query(`SELECT count(*)::int n FROM bms_inventory WHERE tenant_id=$1`,[tenant])).rows[0].n,0);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_inventory_value_entries WHERE tenant_id=$1`,[tenant])).rows[0].n,0);
  const live={kind:"LIVE" as const,locationId:location,requestKey:randomUUID(),lines:[{
    fishName:"FAKE fish",sku,size:"L",supplierName:"FAKE raft",billDate:"2026-11-15",receivedDate:"2026-11-15",
    billKg:"12.500",receivedKg:"12.300",unitPricePerKg:"40",purchaseAmount:"500.00",extraAmount:"25.00",
  }]};
  const [first,second]=await Promise.all([saveFishIntake(tenant,actor,live),saveFishIntake(tenant,actor,live)]);
  assert.deepEqual([first.status,second.status].sort(),["REPLAYED","SAVED"]);
  assert.equal(first.intakeId,second.intakeId);
  const stock=(await query(`SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0];
  assert.equal(stock.current_stock,12300);
  const lots=(await query(`SELECT id,qty,lot_no FROM bms_inventory_lots WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3`,[tenant,location,sku])).rows;
  assert.equal(lots.length,1); assert.equal(lots[0].qty,12300);
  const value=(await query(`SELECT qty,value::text AS value FROM bms_inventory_values WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3`,[tenant,location,sku])).rows[0];
  assert.equal(Number(value.qty),12300); assert.equal(Number(value.value),525);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_fish_intake_lines l
    JOIN bms_stock_movements m ON m.id=l.movement_id
    WHERE l.tenant_id=$1 AND m.tenant_id=$1`,[tenant])).rows[0].n,1);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_audit_log WHERE tenant_id=$1 AND action='fish.receive'`,[tenant])).rows[0].n,1);
  assert.equal((await listFishIntakes(otherTenant,actor)).length,0);
  await assert.rejects(saveFishIntake(tenant,actor,{...live,lines:[{...live.lines[0],receivedKg:"12.301"}]}),
    (error:unknown)=>error instanceof FishIntakeError && error.code==="IDEMPOTENCY_CONFLICT");
});

test("branch restriction, opening-stock guard, and stale placement evidence fail closed",async()=>{
  const options=await fishIntakeOptions(tenant,actor);
  assert.deepEqual(options.locations.map(x=>x.id),[location]);
  const opening={kind:"OPENING" as const,locationId:otherLocation,requestKey:randomUUID(),lines:[{
    fishName:"FAKE fish",sku,size:"L",receivedDate:"2026-11-15",receivedKg:"1.000",purchaseAmount:"40.00",
  }]};
  await assert.rejects(saveFishIntake(tenant,actor,opening));
  assert.equal((await query(`SELECT count(*)::int n FROM bms_fish_intakes WHERE tenant_id=$1 AND kind='OPENING'`,[tenant])).rows[0].n,0);
  await assert.rejects(saveFishIntake(tenant,actor,{...opening,locationId:location}),
    (error:unknown)=>error instanceof FishIntakeError && error.code==="OPENING_NOT_EMPTY");
  const snapshot=await getFishOwnerSnapshot(tenant,actor,"2026-11-15");
  assert.equal(snapshot.stock.totalGrams,12300);
  assert.equal(snapshot.stock.rows.length,1);
  const lot=snapshot.stock.rows[0];
  const input={lotId:lot.lot_id,expectedLotGrams:lot.qty_grams,expectedLotUpdatedAt:lot.lot_updated_at,
    expectedVersion:null,zones:[{zone:"READY" as const,grams:12300}]};
  await assert.rejects(saveFishStorageCount(otherTenant,actor,input),
    (error:unknown)=>error instanceof FishOwnerError && error.code==="LOT_NOT_FOUND");
  // A stock operation can touch the lot and later return it to the same grams.
  // The old count screen must still be rejected instead of relying on quantity alone.
  await query(`UPDATE bms_inventory_lots SET updated_at=updated_at + interval '1 second'
    WHERE tenant_id=$1 AND id=$2`,[tenant,lot.lot_id]);
  await assert.rejects(saveFishStorageCount(tenant,actor,input),
    (error:unknown)=>error instanceof FishOwnerError && error.code==="STALE_LOT");
  const freshLot=(await getFishOwnerSnapshot(tenant,actor,"2026-11-15")).stock.rows[0];
  const freshInput={...input,expectedLotUpdatedAt:freshLot.lot_updated_at};
  assert.equal((await saveFishStorageCount(tenant,actor,freshInput)).status,"SAVED");
  await assert.rejects(saveFishStorageCount(tenant,actor,freshInput),
    (error:unknown)=>error instanceof FishOwnerError && error.code==="STALE_COUNT");
});

test("fish receipt list does not expose another branch to a branch-restricted actor",async()=>{
  const unrestrictedActor=(await query(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
    SELECT 'FAKE unrestricted fish actor',$2,$2,'Administrator',id,$1,'x',true FROM roles
    WHERE name='Administrator' ORDER BY id LIMIT 1 RETURNING id`,[tenant,`fish-other-${tenant}@example.invalid`])).rows[0].id as string;
  const receipt=await saveFishIntake(tenant,unrestrictedActor,{kind:"LIVE",locationId:otherLocation,
    requestKey:randomUUID(),lines:[{fishName:"FAKE fish",sku,size:"L",supplierName:"FAKE other raft",
      billDate:"2026-11-15",receivedDate:"2026-11-15",billKg:"1.000",receivedKg:"1.000",purchaseAmount:"40.00"}]});
  assert.equal(receipt.status,"SAVED");
  assert.ok((await listFishIntakes(tenant,unrestrictedActor)).some(item=>item.id===receipt.intakeId));
  assert.ok(!(await listFishIntakes(tenant,actor)).some(item=>item.id===receipt.intakeId));
  const snapshot=await getFishOwnerSnapshot(tenant,actor,"2026-11-15");
  assert.equal(snapshot.stock.totalGrams,12300);
});

test("delivery plan and ordinary orders keep shipment and payment separate",async()=>{
  const customer=(await query(`INSERT INTO bms_customers(tenant_id,name) VALUES($1,'FAKE fish customer') RETURNING id`,[tenant])).rows[0].id as string;
  const planInput={customerId:customer,locationId:location,requestKey:randomUUID(),lines:[{sku,size:"L",agreedGrams:1000}]};
  const [first,replay]=await Promise.all([
    createFishDeliveryPlan(tenant,actor,planInput),createFishDeliveryPlan(tenant,actor,planInput),
  ]);
  assert.deepEqual([first.status,replay.status].sort(),["REPLAYED","SAVED"]);
  assert.equal(first.planId,replay.planId);
  await assert.rejects(createFishDeliveryPlan(tenant,actor,{...planInput,lines:[{sku,size:"L",agreedGrams:1001}]}),
    (error:unknown)=>error instanceof FishOwnerError && error.code==="IDEMPOTENCY_CONFLICT");
  await assert.rejects(createFishDeliveryPlan(otherTenant,actor,{...planInput,requestKey:randomUUID()}),
    (error:unknown)=>error instanceof FishOwnerError && error.code==="LOCATION_FORBIDDEN");
  const order=await createOrder({tenantId:tenant,channel:"pos",customerId:customer,locationId:location,
    items:[{sku,size:"L",qty:500}]});
  assert.equal(order.status,"CREATED",JSON.stringify(order));
  if (order.status!=="CREATED") return;
  assert.equal((await attachFishDeliveryOrder(tenant,actor,first.planId,order.orderId)).status,"SAVED");
  assert.equal((await attachFishDeliveryOrder(tenant,actor,first.planId,order.orderId)).status,"REPLAYED");
  const snapshot=await getFishOwnerSnapshot(tenant,actor,"2026-11-15");
  const plan=snapshot.deliveries.plans.find(row=>row.id===first.planId);
  assert.ok(plan);
  assert.equal(plan.lines[0].orderedGrams,500);
  assert.equal(plan.lines[0].shippedGrams,0);
  assert.equal(plan.lines[0].remainingGrams,1000);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_audit_log WHERE tenant_id=$1 AND action='fish.delivery.order.attach' AND target=$2`,[tenant,first.planId])).rows[0].n,1);
});

test("unconfigured store currency explains rejection and leaves fish stock unchanged",async()=>{
  const before=(await query(`SELECT current_stock FROM bms_inventory
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].current_stock;
  const key=randomUUID();
  await query(`UPDATE bms_store_profile SET currency=NULL WHERE tenant_id=$1`,[tenant]);
  try {
    await assert.rejects(saveFishIntake(tenant,actor,{kind:"LIVE",locationId:location,requestKey:key,
      lines:[{fishName:"FAKE fish",sku,size:"L",supplierName:"FAKE raft",billDate:"2026-11-15",
        receivedDate:"2026-11-15",billKg:"1.000",receivedKg:"1.000",purchaseAmount:"40.00"}]}),
      (error:unknown)=>error instanceof FishIntakeError && error.code==="STORE_CURRENCY_REQUIRED"
        && error.message.includes("THB"));
  } finally {
    await query(`UPDATE bms_store_profile SET currency='THB' WHERE tenant_id=$1`,[tenant]);
  }
  assert.equal((await query(`SELECT current_stock FROM bms_inventory
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].current_stock,before);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_fish_intakes WHERE tenant_id=$1 AND request_key=$2`,[tenant,key])).rows[0].n,0);
});

test("two receipt lines keep separate generated lots and read-only details stay scoped",async()=>{
  const saved=await saveFishIntake(tenant,actor,{kind:"LIVE",locationId:location,requestKey:randomUUID(),
    lines:[
      {fishName:"FAKE fish",sku,size:"L",supplierName:"FAKE raft",billDate:"2026-11-16",
        receivedDate:"2026-11-16",billKg:"98",receivedKg:"98",purchaseAmount:"3895.50"},
      {fishName:"FAKE fish",sku,size:"L",supplierName:"FAKE raft",billDate:"2026-11-16",
        receivedDate:"2026-11-16",billKg:"7",receivedKg:"7",purchaseAmount:"274.75"},
    ]});
  const detail=await getFishIntake(tenant,actor,saved.intakeId);
  assert.ok(detail);
  assert.deepEqual(detail.lines.map(line=>[line.lineNo,line.receivedGrams,line.lotNo]),[
    [1,98000,`FISH-${saved.intakeId.toUpperCase()}-1`],
    [2,7000,`FISH-${saved.intakeId.toUpperCase()}-2`],
  ]);
  const lots=(await query(`SELECT lot_no,qty FROM bms_inventory_lots
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND lot_no=ANY($4::text[])
    ORDER BY lot_no`,[tenant,location,sku,detail.lines.map(line=>line.lotNo)])).rows;
  assert.deepEqual(lots.map(row=>Number(row.qty)),[98000,7000]);
  assert.equal(await getFishIntake(otherTenant,actor,saved.intakeId),null);
  assert.equal(await getFishIntake(tenant,actor,saved.intakeId,["OPENING"]),null);
  assert.ok(!(await listFishIntakes(tenant,actor,30,["OPENING"])).some(row=>row.id===saved.intakeId));
  const otherBranch=(await query(`SELECT id FROM bms_fish_intakes
    WHERE tenant_id=$1 AND location_id=$2 AND kind='LIVE' ORDER BY created_at DESC LIMIT 1`,
    [tenant,otherLocation])).rows[0].id as string;
  assert.equal(await getFishIntake(tenant,actor,otherBranch),null);
});
