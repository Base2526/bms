// =============================================================
// Restaurant POS (9.44) — source contract
// -------------------------------------------------------------
// ไม่ต้องมี DB · ชุดนี้ตรึง "กฎที่พังแล้วรู้ยาก" ของหน้าร้านอาหาร:
// ลำดับการยืม connection, การผูกบิลกับกะ/เครื่อง/คนขาย, ทางออกของบิลที่ค้าง,
// และการที่กระดานครัวต้องรับตั๋วที่ไม่มีเลขบิลได้
//
// **ทุก assertion อ่านซอร์สที่ตัดคอมเมนต์ออกแล้ว** — บทเรียนจากรอบก่อน: คอมเมนต์ที่
// อธิบายรูปแบบเก่า ("เดิมใช้ pg_advisory_lock()") ทำให้เทสเขียวโดยที่โค้ดจริงไม่มีอะไรเลย
//
//   cd apps/web && npx tsx --test ../../scripts/restaurant-pos-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

/** ตัดคอมเมนต์ JS/TS และ SQL ออกก่อนสแกน — คอมเมนต์ไม่ใช่พฤติกรรม */
function code(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*--.*$/gm, "");
}

test("restaurant migration owns floor, checks, rounds, RLS and one-open-check constraint", async () => {
  const sql = await read("db/migrations/9.44__bms_restaurant_pos.sql");
  for (const table of [
    "bms_restaurant_areas",
    "bms_restaurant_tables",
    "bms_restaurant_checks",
    "bms_restaurant_check_items",
    "bms_restaurant_kitchen_tickets",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /uq_bms_restaurant_checks_open_table/);
  assert.match(sql, /WHERE status IN \('OPEN', 'CLOSING'\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /TO bms_app/);
  assert.match(sql, /bms_orders_restaurant_check_fk/);
});

test("restaurant floor hierarchy cannot cross branches inside one tenant", async () => {
  const sql = code(await read("db/migrations/9.47__bms_restaurant_pos_location_integrity.sql"));
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, area_id\)/);
  assert.match(sql, /REFERENCES bms_restaurant_areas\(tenant_id, location_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, table_id\)/);
  assert.match(sql, /REFERENCES bms_restaurant_tables\(tenant_id, location_id, id\)/);
  assert.match(sql, /VALIDATE CONSTRAINT bms_restaurant_tables_area_location_fk/);
  assert.match(sql, /VALIDATE CONSTRAINT bms_restaurant_checks_table_location_fk/);
});

test("restaurant settlement has a recoverable cross-instance claim", async () => {
  const sql = code(await read("db/migrations/9.48__bms_restaurant_pos_settlement_claim.sql"));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS settlement_attempt_id UUID/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS settlement_started_at TIMESTAMPTZ/);
  assert.match(sql, /settlement_attempt_id IS NULL\) = \(settlement_started_at IS NULL/);
  assert.match(sql, /status = 'CLOSING'\) = \(settlement_attempt_id IS NOT NULL/);
  assert.match(sql, /c\.status IN \('OPEN', 'CLOSING'\)/);
  assert.match(sql, /o\.status = 'COMPLETED'/);
});

test("POS device, shift and restaurant check share one tenant location", async () => {
  const sql = code(await read("db/migrations/9.49__bms_pos_device_shift_location_integrity.sql"));
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id\)/);
  assert.match(sql, /REFERENCES bms_locations\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, device_id\)/);
  assert.match(sql, /REFERENCES bms_pos_devices\(tenant_id, location_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, pos_device_id, pos_shift_id\)/);
  assert.match(sql, /REFERENCES bms_pos_shifts\(tenant_id, location_id, device_id, id\)/);
});

test("restaurant writes require device, PIN and permission at the route boundary", async () => {
  const auth = code(await read("apps/web/app/api/pos/restaurant/routeAuth.ts"));
  const checks = code(await read("apps/web/app/api/pos/restaurant/checks/[id]/route.ts"));
  assert.match(auth, /authenticatePosDevice/);
  assert.match(auth, /verifyCashierPin/);
  assert.match(auth, /cashierHasPermission/);
  assert.match(auth, /getOpenPosShift/);
  // ผู้ที่รับออร์เดอร์ด้วย pos.sell ต้องเป็นคนเริ่ม cancel ได้เอง โดยสิทธิ์เฉพาะเดิมยังใช้ได้
  assert.match(checks, /action === "cancel" \? \["pos\.sell", "restaurant\.check\.cancel"\] as const : "pos\.sell"/);
  assert.match(auth, /permissionChecks\.some\(Boolean\)/);
  assert.match(checks, /parsePosPayments/);
  assert.doesNotMatch(checks, /tenantId\s*:\s*body/);
  // สาขามาจากตัวเครื่องเสมอ — ทุก action ที่แตะบิลต้องได้ locationId ผ่าน `common`
  assert.match(checks, /locationId: auth\.device\.locationId/);
});

test("cancelling a sent restaurant check requires a distinct pos.void approver", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/checks/[id]/route.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(route, /check\.hasCurrentOrder \|\| check\.items\.some/);
  assert.match(route, /isDistinctPosApprover\(auth\.actor\.userId, approverId\)/);
  assert.match(route, /verifyCashierPin\(auth\.device\.tenantId, approverId, approverPin\)/);
  assert.match(route, /cashierHasPermission\(auth\.device\.tenantId, approver\.userId, "pos\.void"\)/);
  assert.match(restaurant, /AS requires_void_approval/);
  assert.match(restaurant, /requires_void_approval && \(/);
  assert.match(restaurant, /approvedByUserId: input\.approvedByUserId \?\? null/);
  assert.match(restaurant, /finally \{\s*client\.release\(\);\s*\}\s*if \(releasedOrderId\)/);
  assert.match(page, /person\.approvals\.includes\("pos\.void"\)/);
  assert.match(page, /approverUserId: cancelNeedsApproval \? cancelApproverId : null/);
  assert.doesNotMatch(page, /window\.prompt/);
});

test("the order taker must leave a cancellation note at both route and service boundaries", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/checks/[id]/route.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));

  assert.match(route, /if \(!reason\).*ต้องระบุ Note/);
  assert.match(restaurant, /const cancellationNote = String\(input\.reason \?\? ""\)\.trim\(\)\.slice\(0, 300\)/);
  assert.match(restaurant, /if \(!cancellationNote\) throw new Error/);
  assert.match(restaurant, /`ยกเลิก: \$\{cancellationNote\}`/);
  assert.match(restaurant, /reason: cancellationNote/);
  assert.match(page, /Note \/ เหตุผลที่ยกเลิก \(จำเป็น\)/);
});

test("restaurant checkout reuses atomic POS settlement and suppresses duplicate kitchen tickets", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  const orders = code(await read("apps/web/lib/bms/orders.ts"));
  assert.match(restaurant, /createOrderInTx\(client,/);
  assert.match(restaurant, /recordPosSale\(/);
  assert.match(restaurant, /reserved_version\) !== Number\(check\.version/);
  assert.match(pos, /restaurant_check_id IS NOT NULL/);
  assert.match(pos, /restaurantOrder\.rowCount\s*\?\s*0/);
  assert.match(orders, /restaurant_check_id/);
});

test("check serialization never parks a pool connection while it waits", async () => {
  // pool ตั้ง max 10 · ตัวล็อกแบบ session ต้องยึด client หนึ่งใบตลอดงาน แล้วงานข้างในยัง
  // ยืมอีกใบ → 5 โต๊ะพร้อมกันทำให้ทุก query ของทั้ง instance ล้มด้วย connection timeout
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /pg_advisory_xact_lock/);
  assert.doesNotMatch(restaurant, /pg_advisory_lock\(/);
  assert.doesNotMatch(restaurant, /pg_advisory_unlock/);
  // ล็อกข้าม instance ต้องอยู่ในทรานแซกชันของงานเอง = หลัง beginTenantTx
  assert.match(restaurant, /beginTenantTx\([^)]*\);\s*await lockCheckInTx\(/);
});

test("a dine-in check is not chained to the device, shift or cashier that opened it", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  // finalizePosSale() ล็อกบิลด้วย cashier_user_id ด้วย — ไม่ประทับใหม่ = คนละคนคิดเงินไม่ได้
  assert.match(restaurant, /UPDATE bms_orders(?: o)?\s+SET pos_device_id = \$3, pos_shift_id = \$4, cashier_user_id = \$5/);
  // และการค้นบิลตอนคิดเงิน/ส่งครัวห้ามผูกกับกะ/เครื่องที่เปิดโต๊ะ (กะเปลี่ยนระหว่างมื้อได้)
  assert.doesNotMatch(restaurant, /AND pos_device_id = \$4 AND pos_shift_id = \$5 AND status IN/);
  assert.doesNotMatch(restaurant, /AND location_id = \$3 AND pos_shift_id = \$4/);
});

test("a check can always be finished or cancelled — CLOSING is never a dead end", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /async function reopenClosingCheck/);
  // เก็บเงินล้มแบบ throw ก็ต้องคืนสถานะ ไม่ใช่เฉพาะผลลัพธ์ที่ไม่ใช่ SOLD
  assert.match(restaurant, /\.catch\(async \(error\) => \{\s*await reopenClosingCheck/);
  assert.match(restaurant, /c\.status IN \('OPEN','CLOSING'\)/);
  // ห้ามยกเลิกบิลที่เก็บเงินไปแล้ว
  assert.match(restaurant, /o\.status NOT IN \('PENDING','CANCELLED'\)/);
});

test("one settlement attempt owns CLOSING and POS closes the check atomically", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  assert.match(restaurant, /const settlementAttemptId = randomUUID\(\)/);
  assert.match(restaurant, /settlement_started_at, '-infinity'::timestamptz/);
  assert.match(restaurant, /settlement_attempt_id = \$7, settlement_started_at = now\(\)/);
  assert.match(restaurant, /restaurantSettlementAttemptId: settlementAttemptId/);
  assert.match(restaurant, /c\.settlement_attempt_id = \$3/);
  assert.match(pos, /AND settlement_attempt_id = \$5\s+FOR UPDATE/);
  assert.match(pos, /SET status = 'PAID', closed_by = \$3, closed_at = now\(\)/);
  assert.match(pos, /restaurant\.check_paid/);
  assert.doesNotMatch(restaurant, /SET status = 'PAID', closed_by/);
});

test("the settlement key is read from the reservation order, never rebuilt", async () => {
  // คีย์ที่ประกอบเองหรือคีย์ที่เก็บค้างไว้ = แหล่งความจริงที่สอง · พอ version ขยับ
  // (ลูกค้าสั่งเพิ่มหลังกดคิดเงินล้มไปครั้งหนึ่ง) คีย์เก่าจะไม่ชนอะไรแล้ว recordPosSale
  // สร้างออร์เดอร์ใบที่สอง = จองสต็อกซ้ำ และใบจองเดิมค้าง PENDING ตลอดไป
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const settle = restaurant.slice(restaurant.indexOf("export async function settleRestaurantCheck"));
  assert.match(settle, /o\.idempotency_key AS order_key/);
  assert.match(settle, /key = String\(check\.order_key \?\? ""\)\.trim\(\)/);
  assert.doesNotMatch(settle, /`restaurant:\$\{input\.checkId\}:v\$\{check\.version\}`/);
  assert.doesNotMatch(restaurant, /check\.settlement_idempotency_key \|\|/);
});

test("a replacement reservation is atomic and gives the old key back", async () => {
  // คีย์คือ `restaurant:<บิล>:v<version>` ผูกกับเนื้อหาบิล ไม่ใช่กับความพยายามครั้งนั้น
  // คืน reservation เก่าคนละ transaction กับสร้างใหม่ = รอบใหม่พลาดแล้วครัวกำลังทำโดยไม่มีของจอง
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const orders = code(await read("apps/web/lib/bms/orders.ts"));
  assert.match(restaurant, /cancelOrderInTx\(client, input\.tenantId, check\.current_order_id\)/);
  assert.match(restaurant, /createOrderInTx\(client,/);
  assert.match(restaurant, /SET idempotency_key = NULL/);
  assert.match(restaurant, /created\.status !== "CREATED"\) \{\s*await client\.query\("ROLLBACK"\);\s*return created/);
  assert.doesNotMatch(restaurant, /releaseReservationOrder/);
  // public createOrder ยังเป็นเจ้าของ transaction เดิม แต่ workflow ใหญ่เรียกแกน in-tx ได้
  assert.match(orders, /export async function createOrderInTx\(/);
  assert.match(orders, /const result = await createOrderInTx\(client, input\)/);
  assert.match(orders, /result\.status !== "CREATED"[\s\S]*ROLLBACK[\s\S]*COMMIT/);
});

test("restaurant operations use restaurant permissions instead of shipping/device aliases", async () => {
  const permissions = code(await read("apps/web/lib/bms/permissions.ts"));
  const floor = code(await read("apps/web/app/api/pos/restaurant/floor/route.ts"));
  const kitchenRoute = code(await read("apps/web/app/api/pos/kitchen/tickets/[id]/status/route.ts"));
  const kitchenResolver = code(await read("apps/web/graphql/bmsStockCapabilities.ts"));
  const migration = code(await read("db/migrations/9.45__bms_restaurant_modifier_pricing_rbac.sql"));
  for (const permission of [
    "restaurant.floor.manage", "restaurant.kitchen.update", "restaurant.check.cancel",
  ]) {
    assert.ok(permissions.includes(`"${permission}"`), `permission catalog ขาด ${permission}`);
    assert.ok(migration.includes(`'${permission}'`), `migration ไม่ seed ${permission}`);
  }
  assert.match(floor, /"restaurant\.floor\.manage"/);
  assert.doesNotMatch(floor, /"pos\.device\.manage"/);
  assert.match(kitchenRoute, /"restaurant\.kitchen\.update"/);
  assert.doesNotMatch(kitchenRoute, /"order\.ship"/);
  assert.match(kitchenResolver, /requirePermission\(ctx, "restaurant\.kitchen\.update"\)/);
});

test("modifier surcharge is catalog-owned and reaches the immutable sale snapshot", async () => {
  const migration = code(await read("db/migrations/9.45__bms_restaurant_modifier_pricing_rbac.sql"));
  const productRecipes = code(await read("apps/web/lib/bms/productRecipes.ts"));
  const orders = code(await read("apps/web/lib/bms/orders.ts"));
  const consumption = code(await read("apps/web/lib/bms/stockConsumption.ts"));
  const commission = code(await read("apps/web/lib/bms/commission.ts"));
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(migration, /ADD COLUMN IF NOT EXISTS price_delta NUMERIC\(12,2\) NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \(price_delta >= 0\)/);
  assert.match(productRecipes, /price_delta = EXCLUDED\.price_delta/);
  assert.match(orders, /FROM bms_product_modifiers/);
  assert.match(orders, /MODIFIER_NOT_FOUND:/);
  assert.match(orders, /modifierUnitPrice/);
  assert.match(orders, /pricingSnapshot:[\s\S]*modifierUnitPrice/);
  assert.match(consumption, /MODIFIER_REQUIRES_RECIPE:/);
  assert.match(commission, /COALESCE\(oi\.pack_unit_price \* oi\.pack_qty, oi\.unit_price \* oi\.qty\)/);
  assert.match(page, /modifier\.priceDelta/);
});

test("restaurant settlement locks the check across instances and safely replays a paid check", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const settle = restaurant.slice(restaurant.indexOf("export async function settleRestaurantCheck"));
  assert.match(settle, /beginTenantTx\(prepare, input\.tenantId/);
  assert.match(settle, /lockCheckInTx\(prepare, input\.tenantId, input\.checkId\)/);
  assert.match(settle, /FOR UPDATE OF c, o/);
  assert.match(settle, /c\.status IN \('OPEN','CLOSING','PAID'\)/);
  assert.match(settle, /check\.order_device_id !== input\.deviceId[\s\S]*check\.order_shift_id !== input\.shiftId[\s\S]*check\.order_cashier_user_id !== input\.actorUserId/);
  assert.match(settle, /if \(check\.status !== "PAID"\)/);
  assert.match(settle, /settlement_started_at, '-infinity'::timestamptz/);
  assert.match(settle, /restaurantSettlementAttemptId: settlementAttemptId/);
  assert.doesNotMatch(settle, /SET status = 'PAID', closed_by/);
});

test("whole-check cancellation releases its order inside the check transaction", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const cancelBlock = restaurant.slice(
    restaurant.indexOf("export async function cancelRestaurantCheck"),
    restaurant.indexOf("async function reopenClosingCheck")
  );
  assert.match(cancelBlock, /beginTenantTx\(client, input\.tenantId/);
  assert.match(cancelBlock, /lockCheckInTx\(client, input\.tenantId, input\.checkId\)/);
  assert.match(cancelBlock, /cancelOrderInTx\(client, input\.tenantId, (?:cancelled|released)OrderId\)/);
  assert.match(cancelBlock, /UPDATE bms_restaurant_kitchen_tickets[\s\S]*UPDATE bms_restaurant_checks[\s\S]*restaurant\.check_cancel[\s\S]*COMMIT/);
  assert.doesNotMatch(cancelBlock, /cancelOrder\(/);
});

test("failed later rounds roll back to the previous sent-item reservation", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const send = restaurant.slice(
    restaurant.indexOf("export async function sendRestaurantKitchenRound"),
    restaurant.indexOf("export async function moveRestaurantCheck")
  );
  assert.match(send, /beginTenantTx\(client, input\.tenantId/);
  assert.match(send, /cancelOrderInTx\(client, input\.tenantId, check\.current_order_id\)/);
  assert.match(send, /createOrderInTx\(client,/);
  assert.match(send, /created\.status !== "CREATED"\) \{\s*await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(send, /restoreSentReservation/);
  assert.doesNotMatch(restaurant, /await query\(\s*`UPDATE bms_restaurant_/);
  assert.doesNotMatch(restaurant, /await query<[^>]+>\(\s*`UPDATE bms_orders/);
});

test("dine-in kitchen tickets cover every sent line and follow the store capability", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /isCapabilityEnabledInTx\(client, input\.tenantId, "KITCHEN_WORKFLOW"\)/);
  // บิลโต๊ะทุกบรรทัดคือของที่ต้องเสิร์ฟ — กรอง RECIPE = น้ำ/เบียร์/ของหวานไม่ขึ้นจอครัว
  // ตัดมาเฉพาะเส้นทางส่งครัว: กฎนี้พูดถึงการออกตั๋ว ไม่ใช่ทั้งไฟล์ (เดิมเช็คทั้งไฟล์ได้เพราะ
  // มีที่เดียวที่เอ่ยถึง RECIPE — พอ listRestaurantMenu เกิดขึ้นก็ต้องระบุขอบเขตให้ตรงกฎ)
  const send = restaurant.slice(
    restaurant.indexOf("export async function sendRestaurantKitchenRound"),
    restaurant.indexOf("export async function moveRestaurantCheck")
  );
  assert.ok(send.length > 0, "หา sendRestaurantKitchenRound ไม่เจอ");
  assert.doesNotMatch(send, /stock_policy = 'RECIPE'/);
});

test("the dine-in menu grid uses its explicit sales surface without filtering by RECIPE", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const menu = restaurant.slice(
    restaurant.indexOf("export async function listRestaurantMenu"),
    restaurant.indexOf("export async function createDefaultRestaurantFloor")
  );
  assert.ok(menu.length > 0, "หา listRestaurantMenu ไม่เจอ");
  // เหตุผลเดียวกับตั๋วครัว: ของที่ขายเป็นชิ้น (น้ำ/ของหวาน) ไม่มีสูตร กรอง RECIPE แล้วสั่งไม่ได้
  // และร้านที่ยังไม่ผูกสูตรจะเห็นกริดว่างทั้งที่มีของขาย
  assert.doesNotMatch(menu, /stock_policy = 'RECIPE'/);
  // 9.51: การอยู่ในเมนูเป็น catalog fact ที่พนักงานกำหนดชัดเจน วัตถุดิบจึงถูกซ่อนด้วย
  // การไม่มี RESTAURANT_POS ไม่ใช่ heuristic ว่าเคยถูกใช้ในสูตรหรือราคาเป็นศูนย์ เพราะสินค้า
  // เดียวกันอาจเป็นทั้งวัตถุดิบและสินค้าพร้อมขาย (เช่น ซอสขวด/น้ำแข็งถุง)
  assert.match(menu, /bms_product_sales_surfaces/);
  assert.match(menu, /surface = 'RESTAURANT_POS'/);
  assert.doesNotMatch(menu, /NOT EXISTS[\s\S]*bms_product_recipe_items/);
  assert.doesNotMatch(menu, /NOT EXISTS[\s\S]*bms_product_modifier_items/);
  // ต้องผูกสาขา ไม่งั้นยอดคงเหลือมาจากสาขาอื่น
  assert.match(menu, /i\.location_id = \$2/);
});

test("kitchen board accepts tickets without an order id and stays branch-aware", async () => {
  const typeDefs = code(await read("apps/web/graphql/typeDefs.ts"));
  const board = code(await read("apps/web/app/(admin)/admin/kitchen/page.tsx"));
  const kitchen = code(await read("apps/web/lib/bms/kitchen.ts"));
  const posQueue = code(await read("apps/web/app/api/pos/kitchen/tickets/route.ts"));
  const posMove = code(await read("apps/web/app/api/pos/kitchen/tickets/[id]/status/route.ts"));
  // ตั๋วบิลโต๊ะเกิดก่อนมีออร์เดอร์ที่ปิดการขาย → orderId เป็น null ได้
  // ตัดเอาเฉพาะบล็อกของ type นี้ก่อน — regex ที่วิ่งข้ามบล็อกจะไปเจอ orderId ของ type อื่น
  const block = typeDefs.slice(typeDefs.indexOf("type BmsKitchenTicket {"));
  const ticketType = block.slice(0, block.search(/\r?\n  }/));
  assert.ok(ticketType.includes("type BmsKitchenTicket {"), "หา type BmsKitchenTicket ไม่เจอ");
  assert.match(ticketType, /\r?\n    orderId: ID\r?\n/);
  assert.doesNotMatch(ticketType, /orderId: ID!/);
  for (const field of ["source: String!", "checkId: ID", "tableName: String", "roundNo: Int"]) {
    assert.ok(ticketType.includes(field), `BmsKitchenTicket ขาดฟิลด์ ${field}`);
  }
  // เลขบิลต้องอยู่ใต้เงื่อนไข และตั๋วที่ไม่มีเลขบิลต้องมีอะไรอ่านแทน (โต๊ะ/รอบ)
  assert.match(board, /\{ticket\.orderId\s*\n?\s*\?/);
  assert.doesNotMatch(board, /·\s*#\{ticket\.orderId\.slice/);
  assert.match(board, /ticket\.tableName \|\| ticket\.tableCode/);
  // จอครัวของเครื่องหน้าร้านเห็นและเลื่อนได้เฉพาะสาขาตัวเอง
  assert.match(kitchen, /locationId\?: string \| null/);
  assert.match(posQueue, /listKitchenTickets\(device\.tenantId, status, limit, device\.locationId\)/);
  assert.match(posMove, /expectedLocationId: device\.locationId/);
});

test("restaurant screen exposes floor, kitchen round, move and settlement actions", async () => {
  const page = await read("apps/web/app/(pos)/pos/restaurant/page.tsx");
  for (const action of ["add_item", "remove_item", "send_kitchen", "move", "cancel", "settle"]) {
    assert.match(page, new RegExp(`"${action}"`));
  }
  assert.match(page, /\/api\/pos\/restaurant\/floor/);
  assert.match(page, /\/api\/pos\/kitchen\/tickets/);
  assert.match(page, /appendSplitPaymentRow/);
  assert.match(page, /payments\.map\(\(payment\) =>/);
  assert.match(page, /setInterval[\s\S]*loadTickets\(\)[\s\S]*5000/);
});

test("restaurant floor correlates kitchen state by check id, not a reusable table name", async () => {
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(page, /checkId: string \| null/);
  assert.match(page, /map\.get\(ticket\.checkId\)/);
  assert.match(page, /map\.set\(ticket\.checkId, row\)/);
  assert.match(page, /kitchen\.get\(check\.id\)/);
  assert.doesNotMatch(page, /map\.get\(ticket\.tableName\)/);
  assert.doesNotMatch(page, /kitchen\.get\(table\.name\)/);
});

test("restaurant UI serializes mutations and changes table selection only after a check loads", async () => {
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(page, /if \(workingRef\.current\) return/);
  assert.match(page, /workingRef\.current = true/);
  assert.match(page, /finally \{ workingRef\.current = false; setWorking\(false\); \}/);
  const chooseTable = page.slice(page.indexOf("async function chooseTable"), page.indexOf("async function openCheck"));
  assert.ok(chooseTable.indexOf("await loadCheck") < chooseTable.indexOf("setSelectedTableId"));
});

test("the check footer never claims a total the bill does not have", async () => {
  // บิลที่เพิ่งเปิดมี version 0 แต่ reservedVersion เป็น null — เทียบสองค่านี้ตรง ๆ ทำให้
  // โต๊ะว่างเปล่าขึ้นคำเตือน "มีรายการที่ยังไม่ส่งครัว" และป้าย "ยอดบิลปัจจุบัน ฿0.00" ก็โกหก
  // เมื่อมีอาหารรออยู่ในบิลแล้ว (amount_due ขยับตอนส่งครัวเท่านั้น)
  const page = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(page, /const hasUnsent = Boolean\(check\?\.items\.some\(\(item\) => item\.status === "NEW"\)\)/);
  assert.doesNotMatch(page, /check\.version !== check\.reservedVersion/);
  assert.match(page, /hasUnsent \? "ยอดที่ส่งครัวแล้ว" : "ยอดบิลปัจจุบัน"/);
  // ยอดที่แสดงต้องมาจาก server เสมอ ห้ามรวมเองที่จอ (สูตรเงินชุดที่สอง)
  assert.doesNotMatch(page, /items\.reduce\(/);
});

test("restaurants keep a way back to the retail register", async () => {
  // คืนสินค้า / รับของเข้าคลัง / มัดจำ / บัตรของขวัญ / ขายเชื่อ อยู่ที่ /pos เท่านั้น
  // การ redirect แบบไม่มีทางออกทำให้ร้านอาหารทำงานเหล่านั้นไม่ได้เลย
  const retail = code(await read("apps/web/app/(pos)/pos/page.tsx"));
  const restaurant = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(retail, /get\("surface"\) !== "retail"/);
  assert.match(restaurant, /\/pos\?surface=retail/);
});

test("a rejected kitchen round tells staff what to do, not an HTTP code", async () => {
  // เจอจากหน้าร้านจริง 2026-09-01: กด "ส่งครัว" แล้วขึ้น "HTTP 409" เฉย ๆ
  // ต้นเหตุ: createOrderInTx ตอบเป็น "สถานะ" ({status:"INSUFFICIENT", available, requested})
  // ไม่มีฟิลด์ error/reason ตัว json() ของหน้าร้านอาหารจึงตกไปที่รหัส HTTP
  // ซึ่งบอกคนหน้าเคาน์เตอร์ไม่ได้ว่าของขาดกี่ชิ้นหรือต้องทำอะไรต่อ
  const restaurant = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(restaurant, /describePosFailure/);
  assert.match(restaurant, /typeof body\?\.status === "string"[\s\S]{0,80}describePosFailure\(body\)/);

  // ข้อความชุดเดียวกับหน้าค้าปลีก — สองหน้าเรียก service เดียวกัน เขียนคนละชุดแล้ววันหนึ่ง
  // ข้อความจะไม่ตรงกันโดยไม่มีอะไรฟ้อง
  const retail = code(await read("apps/web/app/(pos)/pos/page.tsx"));
  assert.match(retail, /from "@\/lib\/pos\/failureMessage"/);
  assert.doesNotMatch(retail, /function describeFailure\(/);

  // ทุกสถานะที่ createOrderInTx ปฏิเสธได้ต้องมีคำแปล ไม่ใช่ตกไปที่ default
  const messages = code(await read("apps/web/lib/pos/failureMessage.ts"));
  for (const status of ["INSUFFICIENT", "NOT_FOUND", "PACK_NOT_FOUND", "BUNDLE_INCOMPLETE", "INVALID_ITEM", "EMPTY"]) {
    assert.match(messages, new RegExp(`case "${status}":`), `ไม่มีคำแปลของ ${status}`);
  }
});

test("a kitchen cancellation drops the line from the bill instead of charging for it", async () => {
  const kitchen = code(await read("apps/web/lib/bms/kitchen.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const posRoute = code(await read("apps/web/app/api/pos/kitchen/tickets/[id]/status/route.ts"));
  const adminResolver = code(await read("apps/web/graphql/bmsStockCapabilities.ts"));
  const migration = code(await read("db/migrations/9.50__bms_restaurant_cancelled_line_keeps_sent_at.sql"));

  // hook เป็น required ไม่ใช่ optional — ผู้เรียกที่ลืมส่งต้องไม่ compile ไม่ใช่เงียบแล้ว
  // เก็บเงินค่าอาหารที่ครัวยกเลิก · `?:` ที่นี่คือการเปิดทางให้สองจอให้ผลต่างกัน
  assert.match(kitchen, /onRestaurantCheckLineCancelled:\s*RestaurantCheckLineCancelHook/);
  assert.doesNotMatch(kitchen, /onRestaurantCheckLineCancelled\?:/);
  // kitchen.ts ต้องไม่ import restaurantPos ตรง ๆ (จะเกิดวง kitchen → restaurantPos → orders → kitchen)
  assert.doesNotMatch(kitchen, /from "\.\/restaurantPos"/);
  // ต้องเรียก hook ก่อน COMMIT = อยู่ในทรานแซกชันเดียวกับการเปลี่ยนสถานะตั๋ว
  const cancelBlock = kitchen.slice(
    kitchen.indexOf('source === "RESTAURANT_CHECK" && status === "CANCELLED"'),
    kitchen.indexOf('await client.query("COMMIT")', kitchen.indexOf('source === "RESTAURANT_CHECK" && status === "CANCELLED"'))
  );
  assert.ok(cancelBlock.length > 0, "หา block ที่เรียก hook ก่อน COMMIT ไม่เจอ");
  assert.match(cancelBlock, /onRestaurantCheckLineCancelled\(/);

  // ทั้งสองจอ (เครื่องขาย + กระดานหลังบ้าน) ต้องให้ผลเดียวกัน
  assert.match(posRoute, /onRestaurantCheckLineCancelled:\s*dropKitchenCancelledLineInTx/);
  assert.match(adminResolver, /onRestaurantCheckLineCancelled:\s*dropKitchenCancelledLineInTx/);

  const drop = restaurant.slice(
    restaurant.indexOf("export async function dropKitchenCancelledLineInTx"),
    restaurant.indexOf("export async function sendRestaurantKitchenRound")
  );
  assert.ok(drop.length > 0, "หา dropKitchenCancelledLineInTx ไม่เจอ");
  // ยอดใหม่ต้องมาจาก createOrderInTx เส้นทางเดียวกับการส่งครัว — ห้ามลบราคาบรรทัดออกจาก
  // amount_due เองที่นี่ เพราะจะเป็นสูตรเงินชุดที่สองที่ drift จากตัวจริง
  assert.match(drop, /cancelOrderInTx\(/);
  assert.match(drop, /createOrderInTx\(/);
  assert.doesNotMatch(drop, /amount_due\s*-/);
  // ลำดับล็อก: กะ → บิล → สต็อก (ตาม createOrderInTx/finalizePosSale) ไม่งั้น deadlock
  // กับการส่งครัวที่วิ่งพร้อมกัน
  assert.ok(
    drop.indexOf("FOR KEY SHARE") < drop.indexOf("lockCheckInTx"),
    "ต้องล็อกกะก่อนล็อกบิล"
  );
  // บิลที่ปิด/กำลังคิดเงินแล้วห้ามถูกแก้ยอด — ตั๋วยกเลิกได้ แต่เงินที่ออกใบไปแล้วแตะไม่ได้
  assert.match(drop, /status = 'OPEN'/);

  // constraint เดิมบังคับ sent_at มีค่าเฉพาะตอน SENT ทำให้ยกเลิกบรรทัดที่ส่งครัวแล้วไม่ได้
  // ทางแก้ต้อง **เก็บ sent_at ไว้** ไม่ใช่ล้างทิ้งเพื่อเลี่ยง constraint (ลบหลักฐานเวลาส่งครัว)
  assert.match(migration, /status = 'CANCELLED'/);
  assert.doesNotMatch(drop, /sent_at\s*=\s*NULL/);
});

/**
 * วัดจริงในเบราว์เซอร์ 2026-09-02: โมดัลทุกตัวของหน้านี้ส่ง getContainer ชี้มาที่ <main>
 * ซึ่งเป็น display:grid · portal root ของ antd เป็น div ปกติและ **ค้างอยู่ใน DOM ต่อแม้ปิด
 * โมดัลแล้ว** จึงเป็น grid item เพิ่มหนึ่งแถว แล้ว align-content ปริยาย (stretch) เกลี่ย
 * ความสูงให้ทุกแถว → แถวของตัวแอปหดลง เหลือแถบว่างท้ายจอถาวร (วัดที่ viewport 820px:
 * 1 โมดัล = หาย 175px · 3 โมดัล = หาย 233px) และปุ่ม "คิดเงิน" ลอยขึ้นจากขอบจอ
 */
test("the page grid declares its own single row so modal portals cannot steal height", async () => {
  const css = code(await read("apps/web/app/(pos)/pos/restaurant/restaurant.module.css"));
  const pageGrid = css.split("\n").find((line) => line.includes(".page {") && line.includes("display: grid"));
  assert.ok(pageGrid, ".page must still be the grid shell");
  assert.match(pageGrid!, /grid-template-rows:\s*100%/,
    "an implicit row lets every antd portal root shrink the app — declare the row explicitly");
  // จอแคบปล่อยให้หน้าเลื่อนตามเนื้อหาโดยตั้งใจ แถวจึงต้องกลับเป็น auto ที่ breakpoint นั้น
  assert.match(css, /min-height: 100dvh;[^}]*grid-template-rows:\s*auto/,
    "the <=900px breakpoint lets the page grow, so the fixed row must be released there");
});

test("modals still portal into the page root so the CSS-module theme applies", async () => {
  const src = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // ถ้าเลิกใช้ getContainer ต้องเลิกพึ่ง grid-template-rows ด้วย (เทสข้างบนจะกลายเป็นของตกค้าง)
  assert.match(src, /getContainer=\{modalContainer\}/);
  assert.match(src, /rootRef\.current \?\? document\.body/);
});

/**
 * กระดานครัว: แต่ละเลนเลื่อนของตัวเอง ไม่ใช่เลื่อนทั้งแผ่น
 * ถ้าเลื่อนทั้งแผ่น เลนที่ตั๋วเยอะจะดันหัวเลนของทุกช่องหายไปพร้อมกัน แล้วครัวอ่านไม่ออกว่า
 * ที่เห็นอยู่คือช่องไหน · วัดจริงที่ viewport 820px: 20 ตั๋วในเลนเดียว → เลนเลื่อนได้
 * (content 2905 / client 519) หัวเลนอยู่กับที่ และทั้งกระดาน/หน้าไม่เลื่อนตาม
 */
test("each kitchen lane scrolls on its own while its header stays put", async () => {
  const css = code(await read("apps/web/app/(pos)/pos/restaurant/restaurant.module.css"));
  const rule = (name: string) => css.split("\n").find((line) => line.trimStart().startsWith(name + " {"));

  const board = rule(".kitchenBoard");
  assert.ok(board, ".kitchenBoard must exist");
  assert.match(board!, /overflow:\s*hidden/, "the board itself must not be the scroller");
  assert.match(board!, /display:\s*flex/, "it has to bound .lanes for the lanes to be scrollable");

  const lanes = rule(".lanes");
  assert.match(lanes!, /min-height:\s*0/, "a grid item defaults to min-height:auto and would never scroll");

  const laneScroll = rule(".laneScroll");
  assert.ok(laneScroll, "tickets need their own scroll box so .laneHead can stay pinned");
  assert.match(laneScroll!, /overflow-y:\s*auto/);
  assert.match(laneScroll!, /min-height:\s*0/);

  assert.match(rule(".laneHead")!, /flex:\s*none/, "the header must not shrink away as tickets pile up");

  const src = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // ใบสั่งต้องอยู่ "ใน" กล่องที่เลื่อน ไม่ใช่ลูกโดยตรงของเลน (ไม่งั้นหัวเลนเลื่อนหายไปด้วย)
  assert.match(src, /styles\.laneScroll\}>[\s\S]{0,600}styles\.ticket\}/,
    "tickets must be rendered inside the scroll box, not dropped straight into the lane");

  // จอแคบเลื่อนทั้งหน้าตามปกติ — เลนจึงต้องคืน overflow ที่ breakpoint นั้น
  assert.match(css, /\.laneScroll \{ overflow: visible; \}|, \.laneScroll \{ overflow: visible; \}/,
    "the <=900px breakpoint scrolls the page as a document, so per-lane scrolling is released");
});
