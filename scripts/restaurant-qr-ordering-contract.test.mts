import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

test("a printed QR is a rotatable table locator, not kitchen authority", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const publicRoute = code(await read("apps/web/app/api/bms/restaurant-qr/[token]/route.ts"));

  assert.match(migration, /UNIQUE \(public_token\)/);
  assert.match(migration, /public_token_hash TEXT NOT NULL/);
  assert.match(migration, /uq_bms_restaurant_table_qr_active/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /WHERE qr\.public_token_hash = \$1/);
  assert.match(service, /restaurant\.table_qr\.rotate/);
  assert.match(publicRoute, /httpOnly: true/);
  assert.match(publicRoute, /sameSite: "lax"/);
  assert.doesNotMatch(publicRoute, /sendRestaurantKitchenRound/);
});

test("scanner session is bound to one OPEN check and dies with that check", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));

  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, check_id\)/);
  assert.match(migration, /bms_expire_restaurant_qr_on_check_close/);
  assert.match(migration, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
  assert.match(migration, /SET status = 'EXPIRED'/);
  assert.match(service, /status = 'OPEN'/);
  // ⚠️ เล็งใหม่หลัง `9.63` (แยกบิล) — เดิม assert `ORDER BY opened_at DESC LIMIT 1` ตรงตัว
  // ซึ่งกลายเป็นการ **ตรึงบั๊ก** ทันทีที่โต๊ะหนึ่งมีบิลเปิดได้หลายใบ: ใบที่เพิ่งเปิดล่าสุดคือ
  // ใบที่เพิ่งถูกแยกออกมา ลูกค้าที่สแกน QR จึงจะไปลงบิลของอีกคนเงียบ ๆ · การันตีที่ต้องคง
  // ไว้คือ "หนึ่ง session ผูกกับบิลเดียวที่เลือกแบบตายตัว" ไม่ใช่ลำดับใดลำดับหนึ่ง
  assert.match(service, /ORDER BY split_group_no, opened_at LIMIT 1\s+FOR UPDATE/);
  assert.doesNotMatch(service, /ORDER BY opened_at DESC LIMIT 1/);
  assert.match(service, /session_token_hash = \$1/);
  assert.match(service, /qr\.public_token_hash = \$2/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.doesNotMatch(service, /JOIN bms_restaurant_checks check\s/);
});

test("public ordering is bounded, structured, idempotent, and only creates PENDING proposals", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const helpers = code(await read("apps/web/app/api/bms/restaurant-qr/routeHelpers.ts"));
  const route = code(await read("apps/web/app/api/bms/restaurant-qr/submissions/route.ts"));

  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'PENDING'/);
  assert.match(migration, /UNIQUE \(tenant_id, session_id, idempotency_key\)/);
  assert.match(service, /MAX_SUBMISSION_ITEMS = 30/);
  assert.match(service, /ON CONFLICT \(tenant_id, session_id, idempotency_key\) DO NOTHING/);
  assert.match(service, /available: Number\(variant\.available\) > 0/);
  assert.doesNotMatch(service.slice(
    service.indexOf("export async function getRestaurantQrMenu"),
    service.indexOf("export async function getRestaurantQrMenuItem")
  ), /kitchenStationId|availableTotal|unavailableResetsAt/);
  assert.match(service, /resolveRestaurantCheckItemRequest/);
  assert.equal((service.match(/modifier\.size = item\.size/g) ?? []).length, 2);
  assert.doesNotMatch(service, /return \{ session, items \}/);
  assert.doesNotMatch(service, /return \{\s*session,\s*submissions/);
  assert.match(helpers, /rateLimit\(`restaurant-qr:/);
  assert.match(helpers, /scope !== "open"[\s\S]{0,300}createHash\("sha256"\)/);
  assert.match(helpers, /x-bms-restaurant-qr/);
  assert.match(route, /"submit", 10/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body/);
  assert.doesNotMatch(route, /tableId\s*:\s*body/);
  assert.doesNotMatch(route, /checkId\s*:\s*body/);
});

test("moving a check preserves scan snapshots while the inbox shows the current table", async () => {
  const ordering = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const move = restaurant.slice(
    restaurant.indexOf("export async function moveRestaurantCheck"),
    restaurant.indexOf("export async function cancelRestaurantCheck")
  );

  assert.match(ordering, /JOIN bms_restaurant_checks check_row[\s\S]{0,260}table_row\.id = check_row\.table_id/);
  assert.doesNotMatch(move, /UPDATE bms_restaurant_qr_submissions/);
});

test("staff acceptance requires device, PIN, open shift and pos.sell", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/qr-orders/route.ts"));
  const auth = code(await read("apps/web/app/api/pos/restaurant/routeAuth.ts"));
  const service = code(await read("apps/web/lib/bms/restaurantPos.ts"));

  assert.match(route, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(auth, /authenticatePosDevice/);
  assert.match(auth, /verifyCashierPin/);
  assert.match(auth, /getOpenPosShift/);
  assert.match(service, /device_id = \$3 AND location_id = \$4[\s\S]{0,80}status = 'OPEN'/);
  assert.match(route, /locationId: auth\.device\.locationId/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body/);
  assert.doesNotMatch(route, /locationId\s*:\s*body/);
  assert.doesNotMatch(route, /checkId\s*:\s*body/);
});

test("accepting a QR proposal and sending its kitchen round is one transaction", async () => {
  const service = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const accept = service.slice(service.indexOf("export async function acceptRestaurantQrSubmission"));

  assert.match(accept, /beginTenantTx\(client, input\.tenantId/);
  assert.match(accept, /status = 'PENDING'/);
  assert.match(accept, /status = 'NEW'/);
  assert.match(accept, /const roundInput: KitchenRoundInput = \{ \.\.\.input, checkId \}/);
  assert.match(accept, /sendRestaurantKitchenRoundInTx\(client, roundInput\)/);
  assert.match(accept, /status = 'ACCEPTED'/);
  assert.match(accept, /restaurant\.qr_submission\.accept/);
  assert.match(accept, /client\.query\("COMMIT"\)/);
  assert.match(accept, /client\.query\("ROLLBACK"\)/);
  assert.match(accept, /มีรายการที่พนักงานยังไม่ส่งครัว/);
});

test("QR admin controls use floor permission and the public page skips admin session chrome", async () => {
  const resolver = code(await read("apps/web/graphql/bmsRestaurantFloorAdmin.ts"));
  const providers = code(await read("apps/web/app/ClientProviders.tsx"));
  const page = code(await read("apps/web/app/(qr)/q/[token]/page.tsx"));
  const adminPage = code(await read("apps/web/app/(admin)/admin/restaurant-floor/page.tsx"));

  assert.match(resolver, /requirePermission\(ctx, "restaurant\.floor\.manage"\)/);
  assert.match(resolver, /issueRestaurantTableQr/);
  assert.match(providers, /pathname\.startsWith\("\/q\/"\)/);
  assert.match(page, /\/api\/bms\/restaurant-qr\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(page, /\/api\/bms\/restaurant-qr\/submissions/);
  assert.match(page, /headers\.set\("x-bms-restaurant-qr", tableToken\)/);
  assert.doesNotMatch(adminPage, /document\.write/);
});

/**
 * ⚠️ เทสนี้เล็งที่ 9.62 ไม่ใช่ 9.60 — 9.60 เขียนเงื่อนไขว่า "ออกจาก OPEN เมื่อไหร่ = ปิดบิล"
 * ซึ่งกิน `CLOSING` (สถานะชั่วคราวตอนกดคิดเงิน 9.48) เข้าไปด้วย · ผลคือกดคิดเงินพลาดหนึ่งครั้ง
 * คำขอที่ลูกค้าส่งเข้ามาก็กลายเป็น EXPIRED ถาวรและหายจากกล่องขาเข้าของพนักงาน
 * (พิสูจน์บนฐาน dev แล้ว) · assertion เดิมตรึงพฤติกรรมนั้นไว้ จึงต้องเล็งใหม่ ไม่ใช่ลบทิ้ง
 */
test("session และคำขอที่ค้างต้องหมดอายุเฉพาะตอนบิลถึงสถานะปลายทาง ไม่ใช่ตอนเริ่มคิดเงิน", async () => {
  const fix = code(await read("db/migrations/9.62__bms_restaurant_qr_expire_on_close_only.sql"));

  assert.match(fix, /CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close/);
  assert.match(fix, /NEW\.status IN \('PAID', 'CANCELLED'\)/);
  assert.match(fix, /OLD\.status IS DISTINCT FROM NEW\.status/);
  assert.doesNotMatch(fix, /NEW\.status <> 'OPEN'/,
    "CLOSING ย้อนกลับเป็น OPEN ได้ จึงห้ามนับว่าเป็นการปิดบิล");
  assert.match(fix, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
  assert.match(fix, /SET status = 'EXPIRED'/);
});

/**
 * เพดานต่อนาทีที่ route กันการยิงรัว แต่ session อยู่ได้ 12 ชั่วโมง — ไม่มีเพดานสะสม
 * โทรศัพท์เครื่องเดียวก็ดันคำขอจริงของโต๊ะอื่นหลุดออกจากกล่องขาเข้า (ตัดที่ 100 แถว) ได้
 */
test("คำขอที่ยังไม่ได้ตรวจต่อโต๊ะมีเพดาน ไม่ใช่แค่เพดานต่อนาที", async () => {
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const submit = service.slice(service.indexOf("export async function submitRestaurantQrOrder"));

  assert.match(service, /MAX_PENDING_SUBMISSIONS_PER_CHECK = \d+/);
  assert.match(submit, /status = 'PENDING'[\s\S]{0,200}MAX_PENDING_SUBMISSIONS_PER_CHECK/);
  assert.match(submit, /check_id = \$2/,
    "นับต่อบิลโต๊ะ ไม่ใช่ต่อ session — โต๊ะหนึ่งมีลูกค้าหลายเครื่องได้");
  assert.ok(
    submit.indexOf("MAX_PENDING_SUBMISSIONS_PER_CHECK") < submit.indexOf("INSERT INTO bms_restaurant_qr_submissions"),
    "ต้องนับใต้ทรานแซกชันเดียวกันก่อนเขียน ไม่ใช่หลังเขียนแล้วค่อยบ่น"
  );
});

/**
 * `restaurant.floor.manage` บอกว่า "จัดผังร้านได้" ไม่ได้บอกว่า "จัดผังของสาขาไหนได้" —
 * mutation ครึ่งหนึ่งรับมาแค่ areaId/tableId จึงต้องแปลงกลับเป็นสาขาก่อนตรวจ ไม่งั้นด่าน
 * ครอบได้แค่ครึ่งเดียว · ที่แรงที่สุดคือ bmsIssueRestaurantTableQr: หมุน QR ของอีกสาขา
 * = สติกเกอร์ที่ติดบนโต๊ะจริงใช้ไม่ได้ทันที และลูกค้าที่กำลังนั่งอยู่ถูกตัด session
 */
test("จัดผังร้าน/หมุน QR ต้องอยู่ในขอบเขตสาขาของคนกด ไม่ใช่แค่มี permission", async () => {
  const resolver = code(await read("apps/web/graphql/bmsRestaurantFloorAdmin.ts"));
  const page = code(await read("apps/web/app/(admin)/admin/restaurant-floor/page.tsx"));

  assert.match(resolver, /userCanAccessLocation/);
  assert.match(resolver, /extensions: \{ code: "FORBIDDEN" \}/);
  // ทุก resolver ต้องผ่านตัวใดตัวหนึ่งของสามตัวนี้ — ห้ามเรียก floorContext() ดิบ ๆ
  for (const [name, guard] of [
    ["bmsRestaurantFloorAdmin(", "floorContextForLocation"],
    ["bmsRestaurantTableQr(", "floorContextForTable"],
    ["bmsIssueRestaurantTableQr(", "floorContextForTable"],
    ["bmsCreateRestaurantArea(", "floorContextForLocation"],
    ["bmsRenameRestaurantArea(", "floorContextForArea"],
    ["bmsReorderRestaurantAreas(", "floorContextForLocation"],
    ["bmsDeleteRestaurantArea(", "floorContextForArea"],
    ["bmsCreateRestaurantTable(", "floorContextForLocation"],
    ["bmsUpdateRestaurantTable(", "floorContextForTable"],
    ["bmsDeleteRestaurantTable(", "floorContextForTable"],
    ["bmsSaveRestaurantFloorLayout(", "floorContextForLocation"],
  ] as const) {
    const start = resolver.indexOf(`async ${name}`);
    assert.ok(start > 0, `resolver ${name} หายไป`);
    const body = resolver.slice(start, start + 700);
    assert.match(body, new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${name} ต้องตรวจขอบเขตสาขาด้วย ${guard}`);
  }
  // ย้ายโต๊ะข้ามโซนได้ แต่โซนปลายทางต้องอยู่ในสาขาที่คนกดดูแล
  assert.match(resolver, /args\.patch\?\.areaId[\s\S]{0,200}locationOfRestaurantArea/);
  // ดรอปดาวน์สาขาต้องเป็นชุดเดียวกับที่ server ยอม ไม่งั้นกดแล้วเจอ FORBIDDEN เฉย ๆ
  assert.match(page, /bmsRestaurantFloorLocations/);
  assert.doesNotMatch(page, /bmsLocations/);
});

/**
 * กติกาเดียวกับหน้าเครื่องขาย (แก้ไปแล้ว 2026-09-05 หลังเคสจริงบน production): ปุ่มที่กดแล้ว
 * server ปฏิเสธแน่ ๆ ต้องกดไม่ได้ และต้องบอกว่าติดกลุ่มไหน · จอลูกค้ามีกลุ่มบังคับแบบเดียวกัน
 * และคนที่เจอคือลูกค้าซึ่งไม่มีพนักงานยืนอธิบายให้
 */
test("จอลูกค้าต้องกันตัวเลือกที่บังคับด้วยกฎตัวเดียวกับหน้าเครื่องขาย", async () => {
  const page = code(await read("apps/web/app/(qr)/q/[token]/page.tsx"));

  assert.match(page, /unmetModifierGroups/,
    "ต้องใช้กฎตัวเดียวกับหน้าเครื่องขาย ไม่ใช่เขียนสำเนาที่สอง");
  assert.match(page, /disabled=\{busy \|\| unmetGroups\.length > 0\}/,
    "ปุ่มเพิ่มลงตะกร้าต้องกดไม่ได้ตอนยังเลือกกลุ่มบังคับไม่ครบ");
  assert.match(page, /ยังต้องเลือก: \$\{unmetGroups/);
  assert.match(page, /Still to choose: \$\{unmetGroups/);
});
