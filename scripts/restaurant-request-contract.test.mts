import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeRestaurantRequestItems, agreedRestaurantQuantities, restaurantRequestFingerprint,
  restaurantRequestReceipt, restaurantRequestSummary, requestQuoteLines,
  RestaurantRequestRejection, isRestaurantRequestRejection, restaurantRequestStatusLine,
  RESTAURANT_REQUEST_REFUSAL_STATUSES, isRestaurantRequestRefusal,
} from '../apps/web/lib/bms/restaurantRequestPolicy';
import { customerTools } from '../apps/web/lib/bms/tools/catalog';
import { SYSTEM_LIMITS } from '../apps/web/lib/bms/assistantKnowledge/limits';
import { SYSTEM_GUIDES } from '../apps/web/lib/bms/assistantKnowledge/guides';
import { SYSTEM_CAPABILITIES } from '../apps/web/lib/bms/assistantKnowledge/capabilities';
import { MIGRATIONS } from './schemaReadiness.mts';

const items = normalizeRestaurantRequestItems([
  {sku:'RICE',size:'BASE',qty:20,modifierCodes:['no_chilli','NO_CHILLI']},
  {sku:'CAKE',size:'SMALL',qty:3,packCode:'box'},
  {sku:'SAUCE',size:'BOTTLE',qty:12},
]);
const lines = items.map((item,i)=>({...item,name:['ข้าว','เค้ก','ซอส'][i],unitName:i===1?'กล่อง':null,
  modifierNames:i===0?['ไม่เผ็ด']:[]}));
const read=(name:string)=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('savory, dessert and condiment counts stay exact; packs are not converted during intake',()=>{
  assert.deepEqual(items.map(item=>item.qty),[20,3,12]);
  assert.equal(items[1].packCode,'BOX');
  assert.deepEqual(items[0].modifierCodes,['NO_CHILLI']);
  assert.equal(requestQuoteLines(lines)[1].displayQty,3);
});
for (const qty of [undefined,null,0,-1,1.5,NaN,Infinity,'2',100001]) {
  test(`intake refuses invalid/missing quantity ${String(qty)} instead of guessing`,()=>{
    assert.throws(()=>normalizeRestaurantRequestItems([{sku:'RICE',size:'BASE',qty}]));
  });
}
test('intake is bounded, validates identifiers and modifier codes',()=>{
  for (const value of [[],Array(21).fill(items[0]),[null],[{...items[0],sku:''}],
    [{...items[0],modifierCodes:[123]}],[{...items[0],packCode:12}]]) {
    assert.throws(()=>normalizeRestaurantRequestItems(value));
  }
});
test('human agreement preserves original quantities and can remove/reduce, never silently increase',()=>{
  const agreed=agreedRestaurantQuantities(lines,[5,0,12]);
  assert.deepEqual(agreed.map(item=>[item.sku,item.qty]),[['RICE',5],['SAUCE',12]]);
  assert.deepEqual(lines.map(item=>item.qty),[20,3,12]);
  for (const quantities of [[21,3,12],[0,0,0],[1,2],[1,2,3,4],[1.5,2,3],['1',2,3]]) {
    assert.throws(()=>agreedRestaurantQuantities(lines,quantities));
  }
});
test('confirmation covers line order, counts, modifiers, branch, fulfillment, requested time, notes and coupon',()=>{
  const fp=(overrides:unknown[] = [])=>restaurantRequestFingerprint(...([
    items,'branch-A','PICKUP',null,'บรรทัด 1 ไม่เผ็ด',null,
  ].map((v,i)=>overrides[i]===undefined?v:overrides[i]) as Parameters<typeof restaurantRequestFingerprint>));
  const original=fp();
  for(const changed of [[items.toReversed()],[[{...items[0],qty:19},...items.slice(1)]],
    [[{...items[0],modifierCodes:[]},...items.slice(1)]],[undefined,'branch-B'],
    [undefined,undefined,'DELIVERY'],[undefined,undefined,undefined,'2026-09-07T12:00:00.000Z'],
    [undefined,undefined,undefined,undefined,'เพิ่มเผ็ด'],[undefined,undefined,undefined,undefined,undefined,'PROMO']]) {
    assert.notEqual(fp(changed),original);
  }
  assert.equal(fp(),original);
});
test('customer summary/receipt distinguish request from confirmed order, without invented prices',()=>{
  const quote={lines:requestQuoteLines(lines),locationName:'สาขาหลัก',fulfillmentType:'PICKUP',
    requestedAt:null,note:'กล่องที่ 1 ไม่ใส่ถั่ว ให้ร้านตรวจการปนเปื้อน'};
  const text=restaurantRequestSummary(quote);
  for(const value of ['× 20','× 3 กล่อง','× 12','ไม่เผ็ด',quote.note,'ยังไม่ต้องชำระเงิน']) assert.ok(text.includes(value));
  assert.match(restaurantRequestReceipt('abcdefgh-123'),/ยังไม่ใช่ออร์เดอร์ที่ร้านยืนยัน/);
  assert.match(restaurantRequestReceipt('abcdefgh-123',true),/not a confirmed order/);
  assert.doesNotMatch(text,/฿|บาท|100%/);
});
test('intake does not reserve/check stock; confirmation alone uses existing atomic order engine',()=>{
  const service=read('apps/web/lib/bms/restaurantRequests.ts');
  const intake=service.slice(service.indexOf('async function resolveLines'),service.indexOf('export async function listRestaurantRequests'));
  assert.doesNotMatch(intake,/bms_inventory|createOrderInTx\(|checkStock\(|menu_unavailability/);
  assert.match(intake,/pg_advisory_xact_lock/);
  assert.match(intake,/source_key=\$4/);
  const review=service.slice(service.indexOf('export async function reviewRestaurantRequest'));
  assert.match(review,/FOR UPDATE/);
  assert.ok(review.indexOf('row.review_key === reviewKey') < review.indexOf('row.version !== input.version'));
  assert.match(review,/createOrderInTx\(client/);
  assert.match(review,/order.status !== 'CREATED'[\s\S]*?ROLLBACK[\s\S]*?REVIEW_REQUIRED/);
  assert.ok(review.indexOf('UPDATE bms_restaurant_order_requests') < review.lastIndexOf("client.query('COMMIT')"));
  assert.match(review,/userCanAccessLocation/);
});
test('original demand, RLS and final-state guards are enforced in migration',()=>{
  const sql=read('db/migrations/9.66__bms_restaurant_order_requests.sql');
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.match(sql,/NULLIF\(current_setting\('bms.tenant_id', true\), ''\)::uuid/);
  assert.match(sql,/Original restaurant demand is immutable/);
  assert.match(sql,/OLD.status IN \('CONFIRMED','CANCELLED'\)/);
  assert.match(sql,/UNIQUE \(tenant_id, channel, customer_ref, source_key\)/);
});
test('customer routes use server identity, admin permission and POS device/PIN; no new sensitive AI tool',()=>{
  const admin=read('apps/web/app/api/bms/restaurant-requests/route.ts');
  const pos=read('apps/web/app/api/pos/restaurant/requests/route.ts');
  assert.match(admin,/authorizeAdminRoute\('order.create'\)/);
  assert.match(admin,/authorizeAdminRoute\('order.view'\)/);
  assert.doesNotMatch(admin+pos,/tenantId:body/);
  assert.match(pos,/authenticateRestaurantMutation\(req,body,'pos.sell'\)/);
  assert.match(pos,/locationId:auth.device.locationId/);
  const catalog=read('apps/web/lib/bms/tools/catalog.ts');
  assert.match(catalog,/ec.surface === "customer" && \(await getStoreProfile\(ec.tenantId\)\).businessArchetype === "restaurant"/);
  assert.doesNotMatch(catalog,/reviewRestaurantRequest/);
  const pipeline=read('apps/web/lib/bms/pipeline.ts');
  assert.match(pipeline,/storedState.pendingRestaurantRequest && storedState.pendingQuoteFingerprint && isConfirmationOnly/);
  assert.match(pipeline,/executeCustomerTool\('create_order', storedState.pendingRestaurantRequest, execCtx\)/);
});

// Source scans below strip comments first. Every comment written while fixing this feature
// names the identifiers these tests search for, so an un-stripped scan would go green on the
// prose that explains a bug instead of the code that fixes it.
const code=(name:string)=>read(name).replace(/\/\*[\s\S]*?\*\//g,'')
  .split(/\r?\n/).map(line=>line.replace(/(^|\s)\/\/.*$/,'')).join('\n');
const sqlCode=(name:string)=>read(name).split(/\r?\n/).map(line=>line.replace(/--.*$/,'')).join('\n');

test('a refusal is an answer to the model, not a system failure that pages the shop',()=>{
  // runtime.ts hides every non-ToolArgError behind "ดึงข้อมูลไม่สำเร็จ" and opens
  // ai.tool_failed. Refusing with a plain Error therefore threw away the instruction the
  // model needed ("ask which branch") and alerted the operator once per customer message
  // while the shop was merely closed.
  const rejection=(()=>{try{normalizeRestaurantRequestItems([]);}catch(error){return error;}})();
  assert.ok(isRestaurantRequestRejection(rejection));
  assert.ok(rejection instanceof Error);
  // Routes rethrow anything carrying `code` so a pg error keeps its SQLSTATE and its 500;
  // a business refusal has to stay a 400 that still shows its message.
  assert.equal((rejection as {code?:unknown}).code,undefined);
  for (const call of [()=>normalizeRestaurantRequestItems([{sku:'RICE',size:'BASE',qty:0}]),
    ()=>agreedRestaurantQuantities(lines,[99,0,0]),()=>agreedRestaurantQuantities(lines,[0,0,0])]) {
    assert.throws(call,RestaurantRequestRejection);
  }
  const service=code('apps/web/lib/bms/restaurantRequests.ts');
  assert.doesNotMatch(service,/throw new Error\(/);
  assert.match(service,/throw new RestaurantRequestRejection\(/);
  const catalog=code('apps/web/lib/bms/tools/catalog.ts');
  const intake=catalog.slice(catalog.indexOf('receiveRestaurantRequest({'),catalog.indexOf('ec.restaurantRequestQuote = result'));
  assert.match(intake,/isRestaurantRequestRejection\(error\)/);
  assert.match(intake,/return \{ ok: false, error: error\.message \}/);
  assert.match(intake,/throw error/); // anything that is not a refusal still reaches the reporter
});

test('pausing or closing online ordering must not block clearing the request queue',()=>{
  // "หยุดรับชั่วคราว" exists to stop new demand while the kitchen catches up. Gating the
  // human confirmation on the same window makes that button block the backlog it created,
  // and requests taken minutes before closing could never be confirmed at all.
  const orders=code('apps/web/lib/bms/orders.ts');
  assert.match(orders,/if \(!ordering\.accepting && !input\.acceptedRestaurantRequestId\) \{/);
  // Two mentions only: the input declaration and that one gate. The ordering window is the
  // only thing a reviewed request skips — branch validity, fulfillment, sold-out-today and
  // stock must all still decide the order.
  assert.equal(orders.match(/acceptedRestaurantRequestId/g)?.length,2);
  const soldOut=orders.indexOf('const soldOutGate');
  assert.ok(soldOut>0);
  assert.doesNotMatch(orders.slice(soldOut,soldOut+400),/acceptedRestaurantRequestId/);
  assert.match(code('apps/web/lib/bms/restaurantRequests.ts'),/acceptedRestaurantRequestId:input\.id/);
});

test('with no AI provider only the legacy *write* path is blocked for restaurants',()=>{
  // The legacy fallback creates an order and reserves stock directly, which is what 9.66
  // exists to stop. The read-only branches after it answer stock questions and create
  // nothing — replying "the assistant is unavailable" to "do you have pad thai" is a worse
  // failure than the one being prevented.
  const pipeline=code('apps/web/lib/bms/pipeline.ts');
  const loopEnd=pipeline.indexOf('tool: "ai:tool-calling"');
  const confirmOrder=pipeline.indexOf('if (intent === "CONFIRM_ORDER")',loopEnd);
  const intake=pipeline.indexOf('restaurant:manual_intake',loopEnd);
  const checkStock=pipeline.indexOf('if (intent === "CHECK_STOCK")',loopEnd);
  assert.ok(loopEnd>0 && confirmOrder>loopEnd && checkStock>confirmOrder);
  assert.ok(intake>confirmOrder && intake<checkStock); // guard inside CONFIRM_ORDER only
  assert.doesNotMatch(pipeline.slice(loopEnd,confirmOrder),/businessArchetype === "restaurant"/);
});

test('staff see why an order was refused, in the one message set both registers already use',()=>{
  const queue=code('apps/web/components/RestaurantRequestQueue.tsx');
  assert.match(queue,/import \{ describePosFailure \} from '@\/lib\/pos\/failureMessage'/);
  assert.match(queue,/describePosFailure\(data\.reason\)/);
  // A raw enum ("INSUFFICIENT", "SOLD_OUT_TODAY", "COUPON_INVALID") tells nobody what to do.
  assert.doesNotMatch(queue,/data\.reason\?\.status/);
});

test('readiness names the column that silently kills the kitchen board, not just the table',()=>{
  // listKitchenTickets() selects bms_orders.restaurant_request_instructions for every order
  // ticket of every shop, so a check that only looks for the new table calls a database
  // ready while the kitchen board is dead.
  const entry=MIGRATIONS.find(migration=>migration.file.startsWith('9.66__'));
  assert.ok(entry);
  assert.deepEqual(entry!.needs,[{kind:'table',name:'bms_restaurant_order_requests'},
    {kind:'column',table:'bms_orders',name:'restaurant_request_instructions'}]);
  // schema-readiness-contract pins the regeneration; this pins that a hand-edit of the
  // committed SQL cannot quietly drop the column row.
  assert.match(read('db/checks/schema-readiness.sql'),/'column', 'bms_orders', 'restaurant_request_instructions'/);
});

test('a request never blocks deleting the shop, order, customer or reviewer it points at',()=>{
  const sql=sqlCode('db/migrations/9.66__bms_restaurant_order_requests.sql');
  assert.match(sql,/tenant_id uuid NOT NULL REFERENCES bms_tenants\(id\) ON DELETE CASCADE/);
  // SET NULL is unavailable to the other three parents: order_id would break the CONFIRMED
  // check constraint, and reviewed_by would fire the immutability trigger so deleting a user
  // would fail on every closed request (the 9.25 -> 9.28 trap).
  assert.doesNotMatch(sql,/ON DELETE SET NULL/);
  const purge=code('apps/web/lib/bms/platform.ts');
  const requests=purge.indexOf('DELETE FROM bms_restaurant_order_requests');
  assert.ok(requests>0);
  for (const table of ['bms_orders','bms_customers','users']) {
    assert.ok(requests<purge.indexOf(`DELETE FROM ${table} WHERE tenant_id`),table);
  }
});

test('chat has exactly one door to the write path, and reorder is not it',()=>{
  // reorder creates a real order and reserves stock from a previous one, with no human review
  // and without the customer re-seeing the lines. It is the second write tool on the customer
  // surface, so rerouting create_order alone left the whole gate walkable.
  assert.ok(!customerTools('restaurant').some(tool=>tool.name==='reorder'));
  assert.ok(customerTools('general').some(tool=>tool.name==='reorder'));
  // Callers that only want the customer-surface names (progress counters, direct deterministic
  // calls) must still see every tool, or unrelated bookkeeping silently changes.
  assert.ok(customerTools().some(tool=>tool.name==='reorder'));
  const catalog=code('apps/web/lib/bms/tools/catalog.ts');
  const reorder=catalog.slice(catalog.indexOf('const reorderTool'),catalog.indexOf('const createShipmentTool'));
  // Withholding it from the model is not a guard: refuse a direct call as well.
  assert.match(reorder,/businessArchetype === "restaurant"[\s\S]{0,240}return \{ ok: false/);
  assert.ok(reorder.indexOf('businessArchetype === "restaurant"')<reorder.indexOf('reorderFromOrder('));
  // And the deterministic route must not call it either.
  assert.match(code('apps/web/lib/bms/pipeline.ts'),/isReorderRequest\(aiInputMessage\) && profile\.businessArchetype !== "restaurant"/);
});

test('a customer who already transferred money can still tell the shop',()=>{
  // submit_payment never creates an order — it attaches a notice to an existing PENDING order,
  // which in a restaurant exists only because a human confirmed a request. Refusing it told a
  // customer who had already paid to submit the whole order again, and left the shop with no
  // record that a slip had arrived. With no bill the tool already answers ORDER_NOT_FOUND.
  const catalog=code('apps/web/lib/bms/tools/catalog.ts');
  const submit=catalog.slice(catalog.indexOf('const submitPaymentTool'),catalog.indexOf('const reorderTool'));
  // A missing end anchor would slice to the end of the file and quietly assert nothing here,
  // and slicing into reorderTool would read *its* restaurant guard as this tool's.
  assert.ok(submit.length>0 && submit.length<catalog.length/2);
  assert.match(submit,/findCustomerPayableOrder\(/);
  assert.doesNotMatch(submit,/reorderFromOrder/);
  assert.doesNotMatch(submit,/businessArchetype === "restaurant"/);
  // The deterministic route is the one that works with no AI provider at all.
  const pipeline=code('apps/web/lib/bms/pipeline.ts');
  for (const guard of ['isPaymentSubmission(aiInputMessage)','isPaymentInfoQuestion(aiInputMessage)',
    'isOrderStatusQuestion(aiInputMessage)']) {
    assert.ok(pipeline.includes(`if (${guard}) {`),guard);
  }
  // The server-composed missing-quantity question lists every item so the model cannot ask
  // about one dish and drop the rest — food orders are exactly where that happens.
  assert.match(pipeline,/if \(!orderMemory\?\.confirmed\) \{/);
});

test('a waiting request is never reported as "no order was found"',()=>{
  // The plain order-status reply talks only about orders. A customer whose request is sitting
  // in the queue would read "no order was found for this account" as the shop having lost it.
  for (const [status,th,en] of [['REQUESTED',/รอร้านตรวจความพร้อม/,/waiting for the shop to review/],
    ['CONTACTING',/ร้านกำลังติดต่อกลับ/,/the shop is contacting you/]] as const) {
    assert.match(restaurantRequestStatusLine({id:'abcdefgh-1234',status},false),th);
    assert.match(restaurantRequestStatusLine({id:'abcdefgh-1234',status},true),en);
    // Still the same promise as the receipt: nothing reserved, nothing owed.
    assert.match(restaurantRequestStatusLine({id:'abcdefgh-1234',status},false),/ยังไม่จองสต็อก/);
    assert.ok(restaurantRequestStatusLine({id:'abcdefgh-1234',status}).includes('abcdefgh'));
  }
  const pipeline=code('apps/web/lib/bms/pipeline.ts');
  const branch=pipeline.slice(pipeline.indexOf('if (isOrderStatusQuestion(aiInputMessage)) {'),
    pipeline.indexOf('deterministic:get_order_status'));
  assert.match(branch,/status === "REQUESTED" \|\| request\.status === "CONTACTING"/);
  assert.match(branch,/\[orderLine, requestLine\]\.filter\(Boolean\)/);
  // Requests are always empty for other archetypes, so the data decides this and the reply of
  // a shop that has none is byte-for-byte what it was.
  assert.doesNotMatch(branch,/businessArchetype/);
});

test('the shop being closed is a status the customer can act on, not a generic failure',()=>{
  // What usually fails between the summary turn and "ยืนยัน" is the shop's own state: someone
  // pressed pause, or the hours ended. Answering that with prose written for the model left the
  // customer with "could not be received" and nothing to do about it.
  for (const status of RESTAURANT_REQUEST_REFUSAL_STATUSES) assert.ok(isRestaurantRequestRefusal({status}));
  for (const other of [{status:'CONFIRMATION_REQUIRED'},{status:'REQUEST_RECEIVED'},{status:'NOPE'},null,{},'ORDERING_PAUSED']) {
    assert.ok(!isRestaurantRequestRefusal(other),JSON.stringify(other));
  }
  const service=code('apps/web/lib/bms/restaurantRequests.ts');
  const intake=service.slice(service.indexOf('export async function receiveRestaurantRequest'),
    service.indexOf('export async function listRestaurantRequests'));
  for (const status of RESTAURANT_REQUEST_REFUSAL_STATUSES) assert.match(intake,new RegExp(`'${status}'`),status);
  // Returned, never thrown — a thrown refusal reaches the model as "ดึงข้อมูลไม่สำเร็จ".
  assert.match(intake,/return await refuse\(\{ status: state\.reason === 'PAUSED'/);
  assert.match(intake,/const refuse = async \(refusal: RestaurantRequestRefusal\) => \{[\s\S]{0,120}ROLLBACK/);
  // Every refusal status must have a customer sentence in orderReply, or the reply silently
  // falls through to its generic "not sure what you want to order" default.
  const pipeline=code('apps/web/lib/bms/pipeline.ts');
  const replies=pipeline.slice(pipeline.indexOf('function orderReply('),pipeline.indexOf('function couponQuoteReply(')>0
    ? pipeline.indexOf('function couponQuoteReply(') : pipeline.length);
  for (const status of RESTAURANT_REQUEST_REFUSAL_STATUSES) assert.ok(replies.includes(`case "${status}"`),status);
  const confirm=pipeline.slice(pipeline.indexOf("tool: 'deterministic:restaurant_request_confirm'")-1200,
    pipeline.indexOf("tool: 'deterministic:restaurant_request_confirm'")+900);
  assert.match(confirm,/isRestaurantRequestRefusal\(received\.result\.data\)/);
  assert.match(confirm,/orderReply\(\{\}, received\.result\.data as CreateOrderResult, englishReply\)/);
});

test('every call outcome survives, and one payment link can never be sent to the wrong customer',()=>{
  // review_note holds only the latest outcome, so a queue built around "call the customer and
  // write down what was agreed" loses each earlier attempt as soon as the next one is saved.
  // The audit row is where who/when/action already lives, so the text goes with it.
  const service=code('apps/web/lib/bms/restaurantRequests.ts');
  assert.match(service,/restaurant\.request_\$\{input\.action\}`,input\.id,\s*\{orderId,status,note:input\.note\.trim\(\)/);
  const queue=code('apps/web/components/RestaurantRequestQueue.tsx');
  // The link is labelled with the request it belongs to and dropped before the next attempt —
  // an unlabelled leftover from the previous confirmation is a payment link for another customer.
  assert.match(queue,/setCheckout\(null\);\s*try \{/);
  assert.match(queue,/\{url:data\.checkoutUrl,ref:selected\.id\.slice\(0,8\)\}/);
  assert.match(queue,/checkout\.ref/);
  // aria-label replaces the visible text for a screen reader, so it has to name the dish; a bill
  // can hold the same dish on several lines with different options.
  assert.match(queue,/aria-label=\{`\$\{english\?'Agreed quantity for':'จำนวนที่ตกลงของ'\} \$\{line\.name\} \/ \$\{line\.size\}/);
});

test('the screen decides "can this be confirmed" with the server rule, not a copy of it',()=>{
  // Same lesson as the modifier modal: never offer a confirmation the server already knows it
  // will reject, and never write the second rule that starts lying the day the first changes.
  const queue=code('apps/web/components/RestaurantRequestQueue.tsx');
  assert.match(queue,/import \{ agreedRestaurantQuantities, type RestaurantRequestLine \}/);
  assert.match(queue,/agreedRestaurantQuantities\(selected\.items,quantities\)/);
  assert.match(queue,/disabled=\{busy\|\|!confirmed\|\|!note\.trim\(\)\|\|agreementError!==null\}/);
  // Both cases the shared rule refuses must reach that state.
  assert.throws(()=>agreedRestaurantQuantities(lines,[0,0,0]),RestaurantRequestRejection);
  assert.throws(()=>agreedRestaurantQuantities(lines,[lines[0].qty+1,0,0]),RestaurantRequestRejection);
  assert.doesNotThrow(()=>agreedRestaurantQuantities(lines,[1,0,0]));
});

test('the rules for requests have one home, and the assistant can read it',()=>{
  // 9.66 shipped its rules as an Alert on /admin/manual only — the "two copies" mistake the
  // knowledge catalog exists to end. The assistant could not answer "why can't I confirm this
  // request?" at all, and the Manual renders SYSTEM_LIMITS anyway, so the group is the one home.
  const group=SYSTEM_LIMITS.find(entry=>entry.id==='limits.restaurant-requests');
  assert.ok(group);
  assert.equal(group!.items.th.length,group!.items.en.length);
  assert.ok(group!.guideIds.includes('orders.restaurant-requests'));
  for (const id of group!.guideIds) assert.ok(SYSTEM_GUIDES.some(guide=>guide.id===id),id);
  // The facts a shop asks about most must be in there, in both languages.
  assert.match(group!.items.th.join('\n'),/หยุดรับออร์เดอร์/);
  assert.match(group!.items.en.join('\n'),/only new requests/);
  // Every entry the queue introduced is reachable, and the register guide stays on the register.
  const guide=(id:string)=>SYSTEM_GUIDES.find(entry=>entry.id===id);
  assert.equal(guide('orders.restaurant-requests')?.pageId,'orders');
  assert.equal(guide('pos.restaurant-requests')?.pageId,'pos');
  assert.ok(SYSTEM_CAPABILITIES.some(entry=>entry.id==='restaurant.chat-requests'));
  // A page-local copy must not come back.
  assert.doesNotMatch(read('apps/web/app/(admin)/admin/manual/page.tsx'),/Restaurant chat requests/);
});
