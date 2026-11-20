import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../apps/web/lib/db.ts";
import { fishIntakeOptions, getFishIntake, listFishIntakes, saveFishIntake, FishIntakeError } from "../apps/web/lib/bms/fishIntake.ts";
import { fishLateCost, FishLateCostError } from "../apps/web/lib/bms/fishLateCost.ts";
import { getFishOwnerSnapshot } from "../apps/web/lib/bms/fishOwnerRead.ts";
import { saveFishStorageCount, FishOwnerError } from "../apps/web/lib/bms/fishOwnerOperations.ts";
import { createFishDeliveryPlan, attachFishDeliveryOrder } from "../apps/web/lib/bms/fishOwnerOperations.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { recordMovement } from "../apps/web/lib/bms/movements.ts";

// Writes only to the disposable restored database on localhost:5433. Like the
// other DB contracts, the uniquely named FAKE fixture remains for inspection.
let tenant: string, otherTenant: string, location: string, otherLocation: string, actor: string;
let firstLiveIntakeId:string,firstHistoryIntakeId:string;
const sku="FAKE-FISH-WEIGHTED";
test.before(async () => {
  assert.ok(["localhost","127.0.0.1","::1"].includes(process.env.POSTGRES_HOST??""));
  assert.equal(process.env.POSTGRES_PORT,"5433");
  assert.ok(["bms_realtime_test","bms_fish_cost_test"].includes(process.env.POSTGRES_DB??""));
  assert.equal((await query("SELECT current_database() AS name")).rows[0].name,process.env.POSTGRES_DB);
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
  firstHistoryIntakeId=savedHistory.intakeId;
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
  firstLiveIntakeId=first.intakeId;
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

test("late cost increases on-hand valuation once and retains original receipt evidence",async()=>{
  const input={lineNo:1,category:"TRANSPORT",amount:"12.34",reason:"FAKE omitted transport",
    reference:"FAKE-RC-1",requestKey:randomUUID()};
  const preview=await fishLateCost(tenant,actor,firstLiveIntakeId,input,"preview");
  assert.equal(preview.status,"PREVIEW");
  if (preview.status!=="PREVIEW") return;
  assert.equal(preview.originalExtraAmount,"25.00");
  assert.equal(preview.newExtraCost,"37.34");
  const financialBefore=(await query(`SELECT
    (SELECT count(*)::int FROM bms_payments WHERE tenant_id=$1) AS payments,
    (SELECT count(*)::int FROM bms_expense_documents WHERE tenant_id=$1) AS expenses,
    (SELECT count(*)::int FROM bms_pos_expenses WHERE tenant_id=$1) AS pos_expenses`,[tenant])).rows[0];
  const receiptBefore=(await query(`SELECT l.purchase_amount::text AS purchase_amount,
    l.extra_amount::text AS extra_amount,l.received_grams,l.movement_id,
    h.location_id FROM bms_fish_intake_lines l JOIN bms_fish_intakes h
      ON h.tenant_id=l.tenant_id AND h.id=l.intake_id
    WHERE l.tenant_id=$1 AND l.intake_id=$2 AND l.line_no=1`,[tenant,firstLiveIntakeId])).rows[0];
  const movementCount=(await query(`SELECT count(*)::int n FROM bms_stock_movements
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].n;
  const [a,b]=await Promise.all([
    fishLateCost(tenant,actor,firstLiveIntakeId,input,"commit",true,preview.previewHash),
    fishLateCost(tenant,actor,firstLiveIntakeId,input,"commit",true,preview.previewHash),
  ]);
  assert.deepEqual([a.status,b.status].sort(),["REPLAYED","SAVED"]);
  assert.equal((await fishLateCost(tenant,actor,firstLiveIntakeId,input,"preview")).status,"REPLAYED");
  const stock=(await query(`SELECT i.current_stock,v.qty,v.value::text AS value
    FROM bms_inventory i JOIN bms_inventory_values v USING(tenant_id,location_id,product_sku,size)
    WHERE i.tenant_id=$1 AND i.location_id=$2 AND i.product_sku=$3 AND i.size='L'`,
    [tenant,location,sku])).rows[0];
  assert.equal(stock.current_stock,12300);assert.equal(Number(stock.qty),12300);
  assert.equal(stock.value,"537.340000");
  const receiptAfter=(await query(`SELECT l.purchase_amount::text AS purchase_amount,
    l.extra_amount::text AS extra_amount,l.received_grams,l.movement_id,
    h.location_id FROM bms_fish_intake_lines l JOIN bms_fish_intakes h
      ON h.tenant_id=l.tenant_id AND h.id=l.intake_id
    WHERE l.tenant_id=$1 AND l.intake_id=$2 AND l.line_no=1`,[tenant,firstLiveIntakeId])).rows[0];
  assert.deepEqual(receiptAfter,receiptBefore,"original receipt and movement link must remain immutable");
  const financialAfter=(await query(`SELECT
    (SELECT count(*)::int FROM bms_payments WHERE tenant_id=$1) AS payments,
    (SELECT count(*)::int FROM bms_expense_documents WHERE tenant_id=$1) AS expenses,
    (SELECT count(*)::int FROM bms_pos_expenses WHERE tenant_id=$1) AS pos_expenses`,[tenant])).rows[0];
  assert.deepEqual(financialAfter,financialBefore,"cost correction must not create payment or expense rows");
  assert.equal((await query(`SELECT count(*)::int n FROM bms_stock_movements
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].n,movementCount);
  const detail=await getFishIntake(tenant,actor,firstLiveIntakeId);
  assert.equal(detail?.lines[0].extraAmount,"25.00");
  assert.equal(detail?.adjustments.length,1);
  assert.equal(detail?.adjustments[0].amount,"12.34");
  assert.equal((await query(`SELECT count(*)::int n FROM bms_audit_log
    WHERE tenant_id=$1 AND action='fish.cost.adjust'`,[tenant])).rows[0].n,1);
  await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,{...input,amount:"13.00"},"commit",true,preview.previewHash),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="IDEMPOTENCY_CONFLICT");
  await assert.rejects(fishLateCost(otherTenant,actor,firstLiveIntakeId,{...input,requestKey:randomUUID()},"preview"),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="INTAKE_LINE_NOT_FOUND");
  await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,{...input,lineNo:2,requestKey:randomUUID()},"preview"),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="INTAKE_LINE_NOT_FOUND");
  await assert.rejects(fishLateCost(tenant,actor,firstHistoryIntakeId,{...input,requestKey:randomUUID()},"preview"),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="INTAKE_LINE_NOT_FOUND");
  const staleInput={...input,requestKey:randomUUID(),amount:"1.00"};
  const stale=await fishLateCost(tenant,actor,firstLiveIntakeId,staleInput,"preview");
  const other={...input,requestKey:randomUUID(),amount:"2.00"};
  const fresh=await fishLateCost(tenant,actor,firstLiveIntakeId,other,"preview");
  assert.equal(fresh.status,"PREVIEW");
  if (stale.status==="PREVIEW"&&fresh.status==="PREVIEW") {
    await fishLateCost(tenant,actor,firstLiveIntakeId,other,"commit",true,fresh.previewHash);
    await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,staleInput,"commit",true,stale.previewHash),
      (e:unknown)=>e instanceof FishLateCostError&&e.code==="PREVIEW_STALE");
  }
  const concurrentInputs=["1.01","2.02"].map(amount=>({lineNo:1,category:"OTHER",
    amount,reason:"FAKE concurrent correction",requestKey:randomUUID()}));
  const concurrentPreviews=await Promise.all(concurrentInputs.map(value=>
    fishLateCost(tenant,actor,firstLiveIntakeId,value,"preview")));
  assert.ok(concurrentPreviews.every(value=>value.status==="PREVIEW"));
  if (concurrentPreviews.every(value=>value.status==="PREVIEW")) {
    const outcomes=await Promise.allSettled(concurrentInputs.map((value,index)=>
      fishLateCost(tenant,actor,firstLiveIntakeId,value,"commit",true,concurrentPreviews[index].previewHash)));
    assert.equal(outcomes.filter(value=>value.status==="fulfilled"&&value.value.status==="SAVED").length,1);
    assert.equal(outcomes.filter(value=>value.status==="rejected"&&value.reason instanceof FishLateCostError&&
      value.reason.code==="PREVIEW_STALE").length,1);
  }
});

test("late cost RLS/grants and audit failure leave value and adjustment unchanged",async()=>{
  const policy=(await query(`SELECT c.relrowsecurity,c.relforcerowsecurity,
      has_table_privilege('bms_app','bms_fish_late_cost_adjustments','SELECT') AS can_select,
      has_table_privilege('bms_app','bms_fish_late_cost_adjustments','INSERT') AS can_insert,
      has_table_privilege('bms_app','bms_fish_late_cost_adjustments','UPDATE') AS can_update,
      has_table_privilege('bms_app','bms_fish_late_cost_adjustments','DELETE') AS can_delete
    FROM pg_class c WHERE c.oid='bms_fish_late_cost_adjustments'::regclass`)).rows[0];
  assert.deepEqual([policy.relrowsecurity,policy.relforcerowsecurity,policy.can_select,
    policy.can_insert,policy.can_update,policy.can_delete],[true,true,true,true,false,false]);
  const isolated=await getClient();
  try {
    await beginTenantTx(isolated,otherTenant);
    const visible=(await isolated.query(`SELECT count(*)::int n FROM bms_fish_late_cost_adjustments
      WHERE tenant_id=$1`,[tenant])).rows[0].n;
    assert.equal(visible,0);
    await isolated.query("COMMIT");
  } catch(e) {await isolated.query("ROLLBACK");throw e;} finally {isolated.release();}
  const before=(await query(`SELECT value::text AS value FROM bms_inventory_values
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].value;
  const count=(await query(`SELECT count(*)::int n FROM bms_fish_late_cost_adjustments
    WHERE tenant_id=$1`,[tenant])).rows[0].n;
  const input={lineNo:1,category:"ICE",amount:"4.00",reason:"FAKE audit rollback",requestKey:randomUUID()};
  const preview=await fishLateCost(tenant,actor,firstLiveIntakeId,input,"preview");
  assert.equal(preview.status,"PREVIEW");
  if (preview.status!=="PREVIEW") return;
  await query(`CREATE FUNCTION bms_test_fish_late_cost_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'FAKE audit fail'; END $$`);
  await query(`CREATE TRIGGER bms_test_fish_late_cost_fail BEFORE INSERT ON bms_audit_log
    FOR EACH ROW WHEN (NEW.action='fish.cost.adjust') EXECUTE FUNCTION bms_test_fish_late_cost_fail()`);
  try {
    await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,input,"commit",true,preview.previewHash),
      /FAKE audit fail/);
  } finally {
    await query(`DROP TRIGGER bms_test_fish_late_cost_fail ON bms_audit_log`);
    await query(`DROP FUNCTION bms_test_fish_late_cost_fail()`);
  }
  await query(`CREATE FUNCTION bms_test_fish_late_cost_insert_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'FAKE adjustment insert fail'; END $$`);
  await query(`CREATE TRIGGER bms_test_fish_late_cost_insert_fail BEFORE INSERT ON bms_fish_late_cost_adjustments
    FOR EACH ROW EXECUTE FUNCTION bms_test_fish_late_cost_insert_fail()`);
  try {
    await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,input,"commit",true,preview.previewHash),
      /FAKE adjustment insert fail/);
  } finally {
    await query(`DROP TRIGGER bms_test_fish_late_cost_insert_fail ON bms_fish_late_cost_adjustments`);
    await query(`DROP FUNCTION bms_test_fish_late_cost_insert_fail()`);
  }
  assert.equal((await query(`SELECT value::text AS value FROM bms_inventory_values
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'`,[tenant,location,sku])).rows[0].value,before);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_fish_late_cost_adjustments
    WHERE tenant_id=$1`,[tenant])).rows[0].n,count);
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
    await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,{lineNo:1,category:"ICE",
      amount:"1.00",reason:"FAKE currency check",requestKey:randomUUID()},"preview"),
      (error:unknown)=>error instanceof FishLateCostError&&error.code==="STORE_CURRENCY_REQUIRED");
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
  await assert.rejects(fishLateCost(tenant,actor,otherBranch,{
    lineNo:1,category:"ICE",amount:"3.00",reason:"FAKE branch denied",requestKey:randomUUID()},"preview"),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="INTAKE_LINE_NOT_FOUND");
  await assert.rejects(fishLateCost(tenant,actor,firstLiveIntakeId,{
    lineNo:1,category:"ICE",amount:"3.00",reason:"FAKE later cost",requestKey:randomUUID()},"preview"),
    (e:unknown)=>e instanceof FishLateCostError&&e.code==="LATER_STOCK_ACTIVITY_REVIEW_REQUIRED");
});

test("partial shipment, return, stock adjustment and full consumption refuse automatic late cost",async()=>{
  const moveSku=`FAKE-FISH-MOVE-${randomUUID()}`;
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES($1,$2,'FAKE moving fish',0.05,true,'V')`,[tenant,moveSku]);
  await query(`INSERT INTO bms_product_variants(tenant_id,product_sku,code)
    VALUES($1,$2,'L')`,[tenant,moveSku]);
  await query(`INSERT INTO bms_product_stock_policies
    (tenant_id,product_sku,stock_policy,base_unit,display_unit,display_precision,lot_tracking)
    VALUES($1,$2,'WEIGHTED','GRAM','kg',3,true)`,[tenant,moveSku]);
  const receipt=await saveFishIntake(tenant,actor,{kind:"LIVE",locationId:location,requestKey:randomUUID(),
    lines:[{fishName:"FAKE moving fish",sku:moveSku,size:"L",supplierName:"FAKE raft",
      billDate:"2026-11-15",receivedDate:"2026-11-15",billKg:"10",receivedKg:"10",purchaseAmount:"100.00"}]});
  const late={lineNo:1,category:"TRANSPORT",amount:"10.00",reason:"FAKE before shipment",requestKey:randomUUID()};
  const beforeShip=await fishLateCost(tenant,actor,receipt.intakeId,late,"preview");
  assert.equal(beforeShip.status,"PREVIEW");
  if (beforeShip.status==="PREVIEW")
    assert.equal((await fishLateCost(tenant,actor,receipt.intakeId,late,"commit",true,beforeShip.previewHash)).status,"SAVED");
  const lotNo=`FISH-${receipt.intakeId.toUpperCase()}-1`;
  const adjust=async(type:"SHIP"|"RETURN"|"COUNT_ADJUST",qty:number,orderItemId?:number)=>{
    const inbound=type==="RETURN";
    const client=await getClient();
    try {
      await beginTenantTx(client,tenant,{editorId:actor});
      await client.query(`UPDATE bms_inventory SET current_stock=current_stock+$5,updated_at=now()
        WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
        [tenant,location,moveSku,"L",inbound?qty:-qty]);
      await client.query(`UPDATE bms_inventory_lots SET qty=qty+$6,updated_at=now()
        WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 AND lot_no=$5`,
        [tenant,location,moveSku,"L",lotNo,inbound?qty:-qty]);
      await recordMovement(client,{tenantId:tenant,locationId:location,sku:moveSku,size:"L",type,qty,
        direction:type==="COUNT_ADJUST"?"OUT":undefined,orderItemId});
      await client.query("COMMIT");
    } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();}
  };
  const tryCost=()=>fishLateCost(tenant,actor,receipt.intakeId,{lineNo:1,category:"ICE",amount:"1.00",
    reason:"FAKE late ice",requestKey:randomUUID()},"preview");
  await adjust("SHIP",1000,990001);
  const shippedValue=(await query(`SELECT amount::text FROM bms_inventory_value_entries
    WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='L'
      AND kind='SHIP' AND order_item_id=990001`,[tenant,location,moveSku])).rows[0].amount;
  assert.equal(shippedValue,"11.000000","future physical COGS must use the revised average");
  await assert.rejects(tryCost(),(e:unknown)=>e instanceof FishLateCostError&&e.code==="LATER_STOCK_ACTIVITY_REVIEW_REQUIRED");
  await adjust("RETURN",500,990001);
  await assert.rejects(tryCost(),(e:unknown)=>e instanceof FishLateCostError&&e.code==="LATER_STOCK_ACTIVITY_REVIEW_REQUIRED");
  await adjust("COUNT_ADJUST",500);
  await assert.rejects(tryCost(),(e:unknown)=>e instanceof FishLateCostError&&e.code==="LATER_STOCK_ACTIVITY_REVIEW_REQUIRED");
  await adjust("SHIP",9000,990002);
  await assert.rejects(tryCost(),(e:unknown)=>e instanceof FishLateCostError&&e.code==="STOCK_ALREADY_CONSUMED");
});
