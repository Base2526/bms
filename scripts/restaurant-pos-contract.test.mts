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

test("restaurant writes require device, PIN and permission at the route boundary", async () => {
  const auth = code(await read("apps/web/app/api/pos/restaurant/routeAuth.ts"));
  const checks = code(await read("apps/web/app/api/pos/restaurant/checks/[id]/route.ts"));
  assert.match(auth, /authenticatePosDevice/);
  assert.match(auth, /verifyCashierPin/);
  assert.match(auth, /cashierHasPermission/);
  assert.match(auth, /getOpenPosShift/);
  assert.match(checks, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(checks, /parsePosPayments/);
  assert.doesNotMatch(checks, /tenantId\s*:\s*body/);
  // สาขามาจากตัวเครื่องเสมอ — ทุก action ที่แตะบิลต้องได้ locationId ผ่าน `common`
  assert.match(checks, /locationId: auth\.device\.locationId/);
});

test("restaurant checkout reuses atomic POS settlement and suppresses duplicate kitchen tickets", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  const orders = code(await read("apps/web/lib/bms/orders.ts"));
  assert.match(restaurant, /createOrder\(/);
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
  assert.match(restaurant, /UPDATE bms_orders\s+SET pos_device_id = \$3, pos_shift_id = \$4, cashier_user_id = \$5/);
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

test("the settlement key is read from the reservation order, never rebuilt", async () => {
  // คีย์ที่ประกอบเองหรือคีย์ที่เก็บค้างไว้ = แหล่งความจริงที่สอง · พอ version ขยับ
  // (ลูกค้าสั่งเพิ่มหลังกดคิดเงินล้มไปครั้งหนึ่ง) คีย์เก่าจะไม่ชนอะไรแล้ว recordPosSale
  // สร้างออร์เดอร์ใบที่สอง = จองสต็อกซ้ำ และใบจองเดิมค้าง PENDING ตลอดไป
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /RETURNING idempotency_key/);
  assert.match(restaurant, /restamped\.rows\[0\]\.idempotency_key/);
  assert.doesNotMatch(restaurant, /check\.settlement_idempotency_key \|\|/);
});

test("an abandoned reservation order gives back its idempotency key", async () => {
  // คีย์คือ `restaurant:<บิล>:v<version>` ผูกกับเนื้อหาบิล ไม่ใช่กับความพยายามครั้งนั้น
  // ออร์เดอร์ที่ถูกยกเลิกแล้วยังถือคีย์ = ส่งครัวซ้ำที่ version เดิมชน unique index ตลอดไป
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /async function releaseReservationOrder/);
  assert.match(restaurant, /SET idempotency_key = NULL/);
  assert.doesNotMatch(restaurant, /await cancelOrder\(input\.tenantId, created\.orderId\)/);
});

test("dine-in kitchen tickets cover every sent line and follow the store capability", async () => {
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /isCapabilityEnabledInTx\(client, input\.tenantId, "KITCHEN_WORKFLOW"\)/);
  // บิลโต๊ะทุกบรรทัดคือของที่ต้องเสิร์ฟ — กรอง RECIPE = น้ำ/เบียร์/ของหวานไม่ขึ้นจอครัว
  assert.doesNotMatch(restaurant, /stock_policy = 'RECIPE'/);
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
  const ticketType = block.slice(0, block.indexOf("\n  }"));
  assert.ok(ticketType.includes("type BmsKitchenTicket {"), "หา type BmsKitchenTicket ไม่เจอ");
  assert.match(ticketType, /\n    orderId: ID\n/);
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
