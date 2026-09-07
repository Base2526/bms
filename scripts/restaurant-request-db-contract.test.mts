// Writes only its own throwaway tenants. Run against a local migrated test database, never production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { query, getClient } from '../apps/web/lib/db';
import { beginTenantTx } from '../apps/web/lib/bms/tenant';
import { receiveRestaurantRequest, reviewRestaurantRequest, listRestaurantRequests } from '../apps/web/lib/bms/restaurantRequests';

test('restaurant intake -> callback -> atomic order; original demand, retries and tenant isolation', async t => {
  assert.ok(['localhost','127.0.0.1','::1','postgres','db'].includes(process.env.POSTGRES_HOST ?? ''),'local test DB required');
  const tenantIds:string[]=[];
  t.after(async()=>{
    if (!tenantIds.length) return;
    for(const table of ['bms_restaurant_order_requests','bms_order_items','bms_order_discounts','bms_orders',
      'bms_stock_movements','bms_inventory','bms_products','bms_customers','bms_store_capabilities',
      'bms_store_profile','bms_locations','bms_audit_log','users']) {
      await query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[tenantIds]);
    }
    await query('DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])',[tenantIds]);
  });
  for (const label of ['restaurant','foreign']) tenantIds.push((await query(`INSERT INTO bms_tenants(name,slug)
    VALUES ($1,$2) RETURNING id`,[`FAKE request test ${label}`,`fake-request-${label}-${crypto.randomUUID()}`])).rows[0].id);
  const [tenantId,foreignTenant]=tenantIds;
  const locationId=(await query(`INSERT INTO bms_locations(tenant_id,code,name) VALUES($1,'MAIN','Test branch') RETURNING id`,[tenantId])).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,business_archetype) VALUES($1,'restaurant')`,[tenantId]);
  const actorUserId=(await query(`INSERT INTO users(name,email,password_hash,tenant_id) VALUES('FAKE reviewer',$1,'x',$2) RETURNING id`,
    [`fake-${crypto.randomUUID()}@example.invalid`,tenantId])).rows[0].id;
  const sku='FAKE-REQUEST-FOOD';
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,vat_category) VALUES($1,$2,'ข้าวทดสอบ',60,'V')`,[tenantId,sku]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    VALUES($1,$2,$3,'BASE',3,0)`,[tenantId,locationId,sku]);
  await query(`INSERT INTO bms_product_variants(tenant_id,product_sku,code) VALUES($1,$2,'BASE') ON CONFLICT DO NOTHING`,[tenantId,sku]);
  for(const surface of ['CUSTOMER_AI','ONLINE_ORDER']) await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,sku,surface]);
  const input={tenantId,channel:'line' as const,customerRef:'fake-customer',locationId,fulfillmentType:'PICKUP',
    items:[{sku,size:'BASE',qty:20}],note:'ไม่ใส่ถั่ว ให้ร้านตรวจการปนเปื้อน'};
  const stock=async()=>(await query(`SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`,[tenantId,locationId,sku])).rows[0];
  const quote=await receiveRestaurantRequest(input);
  assert.equal(quote.status,'CONFIRMATION_REQUIRED');
  if(quote.status!=='CONFIRMATION_REQUIRED') throw new Error('quote missing');
  assert.equal(Number((await stock()).reserved_stock),0);
  const [received,replayed]=await Promise.all([1,2].map(()=>receiveRestaurantRequest({...input,confirmedFingerprint:quote.fingerprint})));
  assert.equal(received.status,'REQUEST_RECEIVED');assert.equal(replayed.status,'REQUEST_RECEIVED');
  if(received.status!=='REQUEST_RECEIVED'||replayed.status!=='REQUEST_RECEIVED') throw new Error('request missing');
  assert.equal(received.requestId,replayed.requestId);
  assert.equal(Number((await stock()).reserved_stock),0);
  assert.equal(Number((await query('SELECT count(*) AS n FROM bms_orders WHERE tenant_id=$1',[tenantId])).rows[0].n),0);
  const id=received.requestId;
  const review={tenantId,locationId,actorUserId,id,version:1,action:'confirm' as const,confirmed:true,
    quantities:[20],note:'โทรคุยแล้ว',kitchenNote:'ข้าว 2 จาน ไม่ใส่ถั่ว — ร้านตรวจแล้ว'};
  const insufficient=await reviewRestaurantRequest(review);
  assert.equal(insufficient.status,'REVIEW_REQUIRED');
  assert.equal(Number((await stock()).reserved_stock),0);
  assert.equal((await listRestaurantRequests({tenantId,actorUserId}))[0].version,1);
  await assert.rejects(()=>reviewRestaurantRequest({...review,tenantId:foreignTenant}));
  await assert.rejects(()=>reviewRestaurantRequest({...review,confirmed:false}));
  await assert.rejects(()=>reviewRestaurantRequest({...review,quantities:[21]}));
  await reviewRestaurantRequest({...review,action:'contact',note:'รอลูกค้าตอบ'});
  await assert.rejects(()=>reviewRestaurantRequest(review),/เปลี่ยนแล้ว/);
  // "หยุดรับชั่วคราว" (and closing time) stops *new* demand. It must not block clearing the
  // backlog it created: intake still refuses, the human confirmation still goes through.
  await query(`UPDATE bms_store_profile SET restaurant_orders_paused=TRUE WHERE tenant_id=$1`,[tenantId]);
  await assert.rejects(()=>receiveRestaurantRequest({...input,confirmedFingerprint:quote.fingerprint}),/พักรับคำขอ/);
  const agreed={...review,version:2,quantities:[2]};
  const results=await Promise.all([1,2].map(()=>reviewRestaurantRequest(agreed)));
  assert.equal(results[0].status,'CONFIRMED');
  assert.equal(results[0].orderId,results[1].orderId);
  assert.match(results[0].checkoutUrl ?? '',/^\/checkout\?t=/);
  assert.equal(Number((await stock()).reserved_stock),2);
  assert.equal(Number((await stock()).current_stock),3);
  const order=(await query('SELECT restaurant_request_instructions FROM bms_orders WHERE tenant_id=$1 AND id=$2',[tenantId,results[0].orderId])).rows[0];
  assert.equal(order.restaurant_request_instructions,agreed.kitchenNote);
  const staff=(await listRestaurantRequests({tenantId,actorUserId}))[0];
  assert.equal(staff.items[0].qty,20);assert.equal(staff.agreedItems[0].qty,2);
  assert.equal(staff.note,input.note);assert.equal(staff.reviewNote,review.note);
  const own=(await listRestaurantRequests({tenantId,channel:'line',customerRef:'fake-customer'}))[0];
  assert.equal(own.phone,null);assert.equal(own.customerName,null);assert.equal(own.reviewNote,null);assert.equal(own.note,null);
  assert.deepEqual(await listRestaurantRequests({tenantId,channel:'line',customerRef:'someone-else'}),[]);
  await assert.rejects(()=>query(`UPDATE bms_restaurant_order_requests SET requested_items='[]'::jsonb WHERE tenant_id=$1 AND id=$2`,[tenantId,id]),/immutable|closed/);
  const client=await getClient();
  try {
    await beginTenantTx(client,foreignTenant);
    assert.equal((await client.query('SELECT id FROM bms_restaurant_order_requests WHERE id=$1',[id])).rowCount,0);
    await client.query('ROLLBACK');
    await client.query('BEGIN');await client.query('SET LOCAL ROLE bms_app');
    await client.query("SELECT set_config('bms.tenant_id','',true)");
    assert.equal((await client.query('SELECT id FROM bms_restaurant_order_requests')).rowCount,0);
    await client.query('ROLLBACK');
  } finally {client.release();}
  const migration=readFileSync(new URL('../db/migrations/9.66__bms_restaurant_order_requests.sql',import.meta.url),'utf8');
  await query(migration); // Re-applying must preserve the accepted request and its order.
  assert.equal((await listRestaurantRequests({tenantId,actorUserId}))[0].orderId,results[0].orderId);
});
