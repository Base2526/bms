import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder, getPurchaseOrder } from "../apps/web/lib/bms/purchase.ts";
import { adjustStock } from "../apps/web/lib/bms/products.ts";
import { createOrder, shipOrder, returnOrder, releaseExpiredOrders } from "../apps/web/lib/bms/orders.ts";
import { takeDeposit } from "../apps/web/lib/bms/deposits.ts";
import { createStockCount, recordCountItem, applyStockCount } from "../apps/web/lib/bms/stockCounts.ts";
import { assertCostingTestDatabase } from "./testing/restaurantCostingFixture.mts";
import { upsertPosDevice } from "../apps/web/lib/bms/pos.ts";

// Real PostgreSQL, restored disposable instance only. Exact fixture UUIDs remain in that
// instance for inspection; never discover or alter an existing tenant's business data.
let tenant: string, location: string, actor: string;
test.before(async () => {
  await assertCostingTestDatabase();
  tenant = randomUUID();
  await query(`INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE stock integrity',$2)`, [tenant, `fake-stock-${tenant}`]);
  location = (await query(`INSERT INTO bms_locations(tenant_id,code,name,branch_code,is_head_office)
    VALUES($1,'MAIN','FAKE stock branch','00000',true) RETURNING id`, [tenant])).rows[0].id;
  actor = (await query(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
    SELECT 'FAKE stock staff',$2,$2,'Administrator',id,$1,'x',true FROM roles
    WHERE name='Administrator' ORDER BY id LIMIT 1 RETURNING id`, [tenant, `stock-${tenant}@example.invalid`])).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,vat_registered) VALUES($1,false)`, [tenant]);
});
async function product(suffix: string, tracked = false, stock = 0) {
  const sku = `FAKE-STOCK-${suffix}`;
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category) VALUES($1,$2,$2,100,true,'V')`, [tenant,sku]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface) VALUES($1,$2,'RETAIL_POS')`, [tenant,sku]);
  if (tracked) await query(`INSERT INTO bms_product_stock_policies(tenant_id,product_sku,stock_policy,lot_tracking,expiry_tracking)
    VALUES($1,$2,'DIRECT',true,true)`, [tenant,sku]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    VALUES($1,$2,$3,'BASE',$4,0)`, [tenant,location,sku,stock]);
  return sku;
}
async function balances(sku: string) {
  return (await query(`SELECT current_stock, reserved_stock,
    (SELECT COALESCE(sum(qty),0)::int FROM bms_inventory_lots l WHERE l.tenant_id=i.tenant_id
      AND l.location_id=i.location_id AND l.product_sku=i.product_sku AND l.size=i.size) AS lots
    FROM bms_inventory i WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`, [tenant,location,sku])).rows[0];
}
async function po(sku: string, qty = 10) {
  const r = await createPurchaseOrder({tenantId:tenant,items:[{sku,size:'BASE',qty,unitCost:10}]});
  assert.equal(r.status,'CREATED',JSON.stringify(r));
  if(r.status!=='CREATED') throw Error('PO fixture failed');
  return r.poId;
}
async function order(sku: string, qty = 2) {
  const r = await createOrder({tenantId:tenant,channel:'pos',locationId:location,items:[{sku,size:'BASE',qty}]});
  assert.equal(r.status,'CREATED',JSON.stringify(r));
  if(r.status!=='CREATED') throw Error('Order fixture failed');
  return r.orderId;
}
async function shipped(sku: string) {
  const id = await order(sku);
  await query(`UPDATE bms_orders SET status='PACKING',fulfillment_type='PICKUP' WHERE tenant_id=$1 AND id=$2`,[tenant,id]);
  assert.equal(await shipOrder(tenant,id),true);
  return id;
}

for (const surface of ['staff', 'pos'] as const) test(`${surface} concurrent receipt retries commit stock, progress and audit once, including replay after completion`, async () => {
  const sku = await product(`RETRY-${surface}`), id = await po(sku, 3), key = randomUUID();
  const device = surface === 'pos' ? await upsertPosDevice(tenant, { locationId: location, code: `FAKE-${surface}`, active: true }) : null;
  const options = { locationId: location, ...(device
    ? { idempotency: { deviceId: device.id, actorUserId: actor, key } }
    : { staffIdempotency: { actorUserId: actor, key } }) };
  const items = [{ sku, size: 'BASE', qty: 1 }];
  const results = await Promise.all([1, 2].map(() => receivePurchaseOrder(tenant, id, items, actor, actor, options)));
  assert.ok(results.every(r => r.status === 'PARTIAL'));
  assert.equal(results.filter(r => 'replayed' in r && r.replayed).length, 1);
  assert.equal((await balances(sku)).current_stock, 1);
  assert.equal((await query(`SELECT count(*)::int n FROM bms_audit_log WHERE tenant_id=$1 AND action='purchase.receive' AND target=$2`, [tenant,id])).rows[0].n, 1);
  assert.equal((await receivePurchaseOrder(tenant,id,[{...items[0],qty:2}],actor,actor,options)).status,'IDEMPOTENCY_CONFLICT');
  assert.equal((await balances(sku)).current_stock, 1);
  assert.equal((await receivePurchaseOrder(tenant,id,[{...items[0],qty:2}],actor,actor,{locationId:location})).status,'RECEIVED');
  const replay = await receivePurchaseOrder(tenant,id,items,actor,actor,options);
  assert.equal(replay.status,'PARTIAL');
  assert.equal('replayed' in replay && replay.replayed,true);
  assert.equal((await balances(sku)).current_stock,3);
  const detail = await getPurchaseOrder(tenant,id);
  assert.equal(detail?.status,'RECEIVED');
  assert.equal(detail?.items[0].qtyReceived,3);
  assert.equal(detail?.items[0].landedUnitCost,10);
  assert.equal(await getPurchaseOrder(randomUUID(),id),null);
});

for (const surface of ['staff', 'staff-default', 'pos'] as const) test(`${surface} replays a committed receipt after its branch is disabled`, async () => {
  const sku = await product(`CLOSED-${surface}`), id = await po(sku, 3), key = randomUUID();
  const device = surface === 'pos' ? (await query('SELECT id FROM bms_pos_devices WHERE tenant_id=$1 AND code=$2',[tenant,'FAKE-pos'])).rows[0] : null;
  const options = { ...(surface === 'staff-default' ? {} : { locationId: location }), ...(device
    ? { idempotency: { deviceId: device.id, actorUserId: actor, key } }
    : { staffIdempotency: { actorUserId: actor, key } }) };
  const items = [{ sku, size: 'BASE', qty: 1 }];
  assert.equal((await receivePurchaseOrder(tenant,id,items,actor,actor,options)).status,'PARTIAL');
  await query('UPDATE bms_locations SET active=false WHERE tenant_id=$1 AND id=$2',[tenant,location]);
  try {
    const replay = await receivePurchaseOrder(tenant,id,items,actor,actor,options);
    assert.equal(replay.status,'PARTIAL');
    assert.equal('replayed' in replay && replay.replayed,true);
    assert.equal((await receivePurchaseOrder(tenant,id,[{...items[0],qty:2}],actor,actor,options)).status,'IDEMPOTENCY_CONFLICT');
    assert.equal((await receivePurchaseOrder(tenant,id,items,actor,actor,{locationId:location})).status,'LOCATION_NOT_FOUND');
    assert.equal((await balances(sku)).current_stock,1);
    assert.equal((await query(`SELECT count(*)::int n FROM bms_audit_log WHERE tenant_id=$1 AND action='purchase.receive' AND target=$2`,[tenant,id])).rows[0].n,1);
  } finally {
    await query('UPDATE bms_locations SET active=true WHERE tenant_id=$1 AND id=$2',[tenant,location]);
  }
});

test('receipt/cancel audit failure rolls back stock, retry ledger and PO; cancellation preserves received stock', async () => {
  const sku = await product('CANCEL'), id = await po(sku);
  const options = { locationId: location, staffIdempotency: { actorUserId: actor, key: randomUUID() } };
  await query(`CREATE OR REPLACE FUNCTION fake_stock_cancel_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.target='${id}' AND NEW.action IN ('purchase.cancel','purchase.receive') THEN RAISE EXCEPTION 'FAKE cancel audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fake_stock_cancel_audit BEFORE INSERT ON bms_audit_log FOR EACH ROW EXECUTE FUNCTION fake_stock_cancel_audit_failure()`);
  try {
    await assert.rejects(cancelPurchaseOrder(tenant,id,actor), /FAKE cancel audit failure/);
    await assert.rejects(receivePurchaseOrder(tenant,id,[{sku,size:'BASE',qty:1}],actor,actor,options), /FAKE cancel audit failure/);
    assert.equal((await balances(sku)).current_stock,0);
    assert.equal((await query("SELECT count(*)::int n FROM bms_inventory_operation_idempotency WHERE tenant_id=$1 AND idempotency_key=$2",[tenant,options.staffIdempotency.key])).rows[0].n,0);
    assert.equal((await query('SELECT status FROM bms_purchase_orders WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0].status,'OPEN');
  } finally {
    await query('DROP TRIGGER fake_stock_cancel_audit ON bms_audit_log; DROP FUNCTION fake_stock_cancel_audit_failure()');
  }
  assert.equal((await receivePurchaseOrder(tenant,id,[{sku,size:'BASE',qty:1}],actor,actor,options)).status,'PARTIAL');
  assert.equal(await cancelPurchaseOrder(tenant,id,actor),true);
  assert.equal((await query("SELECT actor FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action='purchase.cancel'",[tenant,id])).rows[0].actor,actor);
  assert.equal((await receivePurchaseOrder(tenant,id,[{sku,size:'BASE',qty:1}],actor,actor,{locationId:location})).status,'INVALID_STATE');
  assert.equal((await balances(sku)).current_stock,1);
});

test('first tracked PO receipt refuses absent identity, rolls back earlier lines, then receives exact lots', async () => {
  const plain = await product('PO-PLAIN'), tracked = await product('PO-TRACKED',true);
  const created = await createPurchaseOrder({tenantId:tenant,items:[{sku:plain,size:'BASE',qty:10,unitCost:10},{sku:tracked,size:'BASE',qty:10,unitCost:10}]});
  assert.equal(created.status,'CREATED'); if(created.status!=='CREATED') return;
  for(const patch of [{},{lotNo:'A'}]) {
    const r = await receivePurchaseOrder(tenant,created.poId,[{sku:plain,size:'BASE',qty:2},{sku:tracked,size:'BASE',qty:2,...patch}],actor,actor,{locationId:location});
    assert.equal(r.status,'INVALID_INPUT');
    if(r.status==='INVALID_INPUT') assert.match(r.reason ?? '',/ต้องระบุ(เลขล็อต|วันหมดอายุ)/);
    assert.equal((await balances(plain)).current_stock,0);
    assert.equal((await balances(tracked)).current_stock,0);
    assert.equal((await query(`SELECT sum(qty_received)::int n FROM bms_purchase_order_items WHERE tenant_id=$1 AND po_id=$2`,[tenant,created.poId])).rows[0].n,0);
  }
  const r=await receivePurchaseOrder(tenant,created.poId,[{sku:tracked,size:'BASE',qty:10,lotNo:'A',expiryDate:'2099-01-01'}],actor,actor,{locationId:location});
  assert.equal(r.status,'PARTIAL'); assert.deepEqual(await balances(tracked),{current_stock:10,reserved_stock:0,lots:10});
});

test('manual adjustment cannot create untracked opening stock for a tracked product',async()=>{
  const sku=await product('ADJUST',true);
  await assert.rejects(adjustStock(tenant,sku,'BASE',3,null,actor,actor,location),/ล็อต/);
  assert.deepEqual(await balances(sku),{current_stock:0,reserved_stock:0,lots:0});
});

for(const corrupt of [false,true]) test(`full return ${corrupt?'rejects missing allocation atomically':'restores exact lots once'}`,async()=>{
  const sku=await product(`RETURN-${corrupt}`,true), id=await po(sku);
  assert.equal((await receivePurchaseOrder(tenant,id,[{sku,size:'BASE',qty:10,lotNo:'A',expiryDate:'2099-01-01'}],actor,actor,{locationId:location})).status,'RECEIVED');
  const sale=await shipped(sku);
  assert.deepEqual(await balances(sku),{current_stock:8,reserved_stock:0,lots:8});
  if(corrupt){
    await query(`DELETE FROM bms_order_item_lots WHERE tenant_id=$1 AND order_item_id IN
      (SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2)`,[tenant,sale]);
    await assert.rejects(returnOrder(tenant,sale),/STOCK_REVIEW_REQUIRED/);
    assert.deepEqual(await balances(sku),{current_stock:8,reserved_stock:0,lots:8});
    assert.equal((await query(`SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`,[tenant,sale])).rows[0].status,'SHIPPED');
    assert.equal((await query(`SELECT 1 FROM bms_stock_movements WHERE tenant_id=$1 AND ref_order_id=$2 AND type='RETURN'`,[tenant,sale])).rowCount,0);
  }else{
    assert.equal(await returnOrder(tenant,sale),true);
    assert.equal(await returnOrder(tenant,sale),false);
    assert.deepEqual(await balances(sku),{current_stock:10,reserved_stock:0,lots:10});
  }
});

test('count rejects fractional input and applies only the variance after an intervening stock change',async()=>{
  const sku=await product('COUNT',false,10);
  const c=await createStockCount({tenantId:tenant,locationId:location,createdBy:actor}); assert.equal(c.status,'CREATED'); if(c.status!=='CREATED')return;
  const input={tenantId:tenant,countId:c.countId,sku,size:'BASE',actorUserId:actor};
  assert.equal((await recordCountItem({...input,countedQty:8.5})).status,'INVALID');
  assert.equal((await recordCountItem({...input,countedQty:8})).status,'OK');
  await adjustStock(tenant,sku,'BASE',-3,null,actor,actor,location);
  assert.equal((await applyStockCount({tenantId:tenant,countId:c.countId,actorUserId:actor})).status,'APPLIED');
  assert.equal((await balances(sku)).current_stock,5);
  assert.equal((await applyStockCount({tenantId:tenant,countId:c.countId,actorUserId:actor})).status,'WRONG_STATE');
  assert.equal((await balances(sku)).current_stock,5);
});

test('expiry preserves a paid deposit and releases only the ordinary order',async()=>{
  const sku=await product('EXPIRY',false,10), protectedOrder=await order(sku), ordinary=await order(sku);
  assert.equal((await takeDeposit({tenantId:tenant,orderId:protectedOrder,amount:50,method:'CASH',createdBy:actor,idempotencyKey:randomUUID()})).status,'TAKEN');
  await query(`UPDATE bms_orders SET created_at=now()-interval '2 hours' WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[tenant,[protectedOrder,ordinary]]);
  const r=await releaseExpiredOrders(30,tenant); assert.deepEqual(r,{released:1,orderIds:[ordinary],failed:[]});
  assert.deepEqual(await balances(sku),{current_stock:10,reserved_stock:2,lots:0});
  assert.equal((await query(`SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`,[tenant,protectedOrder])).rows[0].status,'PENDING');
});

test('tenant role cannot change another tenant inventory even with a matching SKU',async()=>{
  const sku=await product('RLS',false,10), c=await getClient();
  try{
    await beginTenantTx(c,randomUUID());
    assert.equal((await c.query(`UPDATE bms_inventory SET current_stock=0 WHERE tenant_id=$1 AND product_sku=$2`,[tenant,sku])).rowCount,0);
    await c.query('ROLLBACK');
  }finally{c.release();}
  assert.equal((await balances(sku)).current_stock,10);
});

test('expiry preserves the reserved stock of a board-game billing group',async()=>{
  const sku=await product('BOARD-GAME',false,10), id=await order(sku);
  const area=(await query(`INSERT INTO bms_board_game_areas(tenant_id,location_id,name)
    VALUES($1,$2,'FAKE stock area') RETURNING id`,[tenant,location])).rows[0].id;
  const table=(await query(`INSERT INTO bms_board_game_tables(tenant_id,location_id,area_id,code,name)
    VALUES($1,$2,$3,'FAKE-STOCK','FAKE stock table') RETURNING id`,[tenant,location,area])).rows[0].id;
  const seating=(await query(`INSERT INTO bms_board_game_seatings(tenant_id,location_id,table_id)
    VALUES($1,$2,$3) RETURNING id`,[tenant,location,table])).rows[0].id;
  const session=(await query(`INSERT INTO bms_board_game_sessions(tenant_id,location_id,table_id,open_idempotency_key,open_request_hash,seating_id)
    VALUES($1,$2,$3,$4,'FAKE',$5) RETURNING id`,[tenant,location,table,randomUUID(),seating])).rows[0].id;
  const group=(await query(`INSERT INTO bms_board_game_billing_groups(tenant_id,location_id,session_id,group_no,current_order_id)
    VALUES($1,$2,$3,1,$4) RETURNING id`,[tenant,location,session,id])).rows[0].id;
  await query(`UPDATE bms_orders SET board_game_session_id=$3,board_game_billing_group_id=$4,
    created_at=now()-interval '2 hours' WHERE tenant_id=$1 AND id=$2`,[tenant,id,session,group]);
  assert.deepEqual(await releaseExpiredOrders(30,tenant),{released:0,orderIds:[],failed:[]});
  assert.deepEqual(await balances(sku),{current_stock:10,reserved_stock:2,lots:0});
  assert.equal((await query(`SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`,[tenant,id])).rows[0].status,'PENDING');
});
