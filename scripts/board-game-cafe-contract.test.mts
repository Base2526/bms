import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { boardGameBillableMinutes } from "../apps/web/lib/bms/boardGameCafe.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("board-game migration keeps products, time rates and playable assets separate", () => {
  const sql = read("db/migrations/9.80__bms_board_game_cafe_core.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_time_rates/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_session_participants/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_titles/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_copies/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_session_games/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_idempotency_results/);
  assert.match(sql, /hourly_rate_snapshot/);
  assert.match(sql, /minimum_minutes_snapshot/);
  assert.match(sql, /rounding_minutes_snapshot/);
  assert.match(sql, /grace_minutes_snapshot/);
  assert.match(sql, /charge_snapshot/);
  assert.match(sql, /time-based play sessions are calculated by this domain/i);
  assert.match(sql, /These are not products and are never sold by typing a SKU/);
  assert.match(sql, /They are assets, not sellable inventory stock/);
  assert.doesNotMatch(sql, /ALTER TABLE bms_products[\s\S]{0,220}(time|hour|session|board_game)/i);
});

test("admin manual documents the complete board-game operating boundary in both languages", () => {
  const manual = read("apps/web/app/(admin)/admin/manual/page.tsx");

  assert.match(manual, /ร้านบอร์ดเกม: เปิด session จนส่งยอดไปเก็บเงิน/);
  assert.match(manual, /ตั้งเรตทั่วไป นักเรียน เด็ก หรือสมาชิกแยกจาก Products/);
  assert.match(manual, /เกมที่ขายขาดยังเป็นสินค้าและสต็อกปกติ/);
  assert.match(manual, /หยุดเวลาและคิดราคา/);
  assert.match(manual, /ไปเก็บเงินที่ POS/);
  assert.match(manual, /ยังไม่มีสัญญาสมาชิกรายเดือน\/รายปีหรือที่เก็บเลขบัตรประชาชนแบบเข้ารหัส/);
  assert.match(manual, /Board-game cafe: from opening a session to POS settlement/);
  assert.match(manual, /checking one out changes asset status without reducing retail stock/);
  assert.match(manual, /does not yet provide monthly\/yearly subscription contracts or encrypted national-ID storage/);
  assert.match(manual, /they do not automatically issue separate receipts/);
});

test("board-game tenant tables have RLS, bms_app grants, revisions and permissions", () => {
  const sql = read("db/migrations/9.80__bms_board_game_cafe_core.sql");
  for (const table of [
    "bms_board_game_areas",
    "bms_board_game_tables",
    "bms_board_game_time_rates",
    "bms_board_game_sessions",
    "bms_board_game_session_participants",
    "bms_board_game_titles",
    "bms_board_game_copies",
    "bms_board_game_session_games",
  ]) {
    assert.match(sql, new RegExp(`'${table}'`), `${table} is not included in the RLS loop`);
    assert.match(sql, new RegExp(`create_revision_trigger\\('${table}'\\)`), `${table} has no revision trigger`);
  }
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON[\s\S]*bms_board_game_sessions[\s\S]*TO bms_app/);
  assert.match(sql, /board_game\.session\.manage/);
  assert.match(sql, /board_game\.session\.override_time/);
  assert.match(sql, /board_game\.session\.cancel/);
  assert.match(sql, /board_game\.floor\.manage/);
  assert.match(sql, /board_game\.rate\.manage/);
  assert.match(sql, /board_game\.library\.manage/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, area_id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, table_id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, pos_device_id, pos_shift_id\)/);
  assert.match(sql, /open_idempotency_key/);
  assert.match(sql, /settlement_request_hash/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, action, idempotency_key\)/);
  assert.match(sql, /status NOT IN \('CLOSING', 'PAID'\)/);
});

test("board-game hardening migration upgrades legacy rows and converges constraints", () => {
  const sql = read("db/migrations/9.81__bms_board_game_cafe_core_hardening.sql");
  assert.match(sql, /legacy-open:/);
  assert.match(sql, /legacy-close:/);
  assert.match(sql, /legacy-cancel:/);
  assert.match(sql, /status = 'CLOSING'\s+AND ended_at IS NULL/);
  assert.match(sql, /GREATEST\(started_at, updated_at\)/);
  assert.match(sql, /minimum_minutes_snapshot = r\.minimum_minutes/);
  assert.match(sql, /SET billable = FALSE/);
  assert.match(sql, /bms_board_game_sessions_ended_at_shape/);
  assert.match(sql, /status = 'OPEN'\) = \(ended_at IS NULL\)/);
  assert.match(sql, /DROP CONSTRAINT %I/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, current_order_id\)/);
  assert.match(sql, /ALTER TABLE bms_board_game_idempotency_results FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /DROP COLUMN IF EXISTS alert_status/);
});

test("board-game session detail fulfills its non-null alert contract", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const graphql = read("apps/web/graphql/bmsPosDevice.ts");

  assert.match(graphql, /type BmsPosBoardGameSession[\s\S]{0,260}alertBeforeMinutes: Int!/);
  assert.match(
    service,
    /function mapSessionRow[\s\S]{0,900}alertBeforeMinutes:\s*Number\(row\.alert_before_minutes \?\? 15\)/,
    "the detail query must not null the whole session after a successful open",
  );
});

test("board-game payment reuses POS and atomically links the paid bill", () => {
  const sql = read("db/migrations/9.82__bms_board_game_pos_settlement.sql");
  const groupSql = read("db/migrations/9.89__bms_board_game_billing_groups.sql");
  const orders = read("apps/web/lib/bms/orders.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const restRoute = read("apps/web/app/api/pos/sale/route.ts");
  const graphql = read("apps/web/graphql/bmsPosDevice.ts");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS board_game_session_id UUID/);
  assert.match(sql, /status IN \('PENDING', 'PAID', 'COMPLETED'\)/);
  assert.match(sql, /restaurant_check_id IS NULL OR board_game_session_id IS NULL/);
  // `9.89` ย้ายการอ้างสิทธิ์ "บิลที่ยังทำงานอยู่" จากโต๊ะไปที่กลุ่ม — index เดิมคือสิ่งที่ทำให้
  // กลุ่มที่สองของโต๊ะเดียวกันเก็บเงินไม่ได้เลย จึงต้องถูกทิ้ง ไม่ใช่เก็บไว้คู่กัน
  assert.match(groupSql, /DROP INDEX IF EXISTS uq_bms_orders_active_board_game_session/);
  assert.match(groupSql, /uq_bms_orders_active_board_game_group[\s\S]{0,200}board_game_billing_group_id IS NOT NULL/);
  assert.match(orders, /charge_snapshot/);
  // `9.90` เปิดทางให้บิลถูกประกอบได้ทั้งตอนยังเล่น (ใบจองของ tab) และตอนปิด (บวกค่าเล่น)
  // สิ่งที่ยังต้องจริงเสมอคือ **ปล่อยใบที่ถือสิทธิ์อยู่ก่อนจองใหม่ ในทรานแซกชันเดียวกัน**
  // ไม่งั้นจะมีช่วงที่เครื่องอื่นขายของที่ลูกค้าถืออยู่ในมือไปได้
  assert.match(orders, /g\.status IN \('OPEN', 'CLOSING'\)/);
  assert.match(orders, /board_game_billing_group_id = \$2 AND status = 'PENDING'[\s\S]{0,400}cancelOrderInTx\(client, tenantId, row\.id\)/);
  // รายการบน tab เป็นของ server เสมอ — คนหน้าเครื่องส่งเข้ามาเองไม่ได้
  assert.match(orders, /FROM bms_board_game_group_items[\s\S]{0,200}status = 'ACTIVE'/);
  assert.match(orders, /Board game time \/ ค่าเล่นบอร์ดเกม/);
  // order เก็บทั้งกลุ่มที่ถูกเก็บเงิน และโต๊ะที่บิลนั้นมาจาก — โต๊ะเป็นประวัติ กลุ่มคือสิ่งที่จ่าย
  assert.match(orders, /boardGameSessionId, boardGameBillingGroupId\]\s*\)/);
  assert.match(orders, /board_game_session_id,\s*\n\s*board_game_billing_group_id\)/);
  assert.match(pos, /UPDATE bms_board_game_billing_groups\s*\n\s*SET status = 'PAID', current_order_id = \$3/);
  assert.match(pos, /board_game\.billing_group_paid/);
  assert.match(pos, /บิลบอร์ดเกมไม่พร้อมรับชำระหรือถูกบิลอื่นชำระแล้ว/);
  assert.match(restRoute, /lines\.length === 0 && !boardGameBillingGroupId/);
  assert.match(graphql, /boardGameBillingGroupId: ID/);
});

test("both registers preview board-game discounts on the combined server-priced basket", () => {
  const page = read("apps/web/app/(pos)/pos/page.tsx");
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const route = read("apps/web/app/api/pos/member/preview/route.ts");
  const graphql = read("apps/web/graphql/bmsPosDevice.ts");
  const mobile = read("apps/mobile/src/screens/sell/CheckoutScreen.tsx");
  const mobileOperation = read("apps/mobile/src/graphql/operations.graphql");
  // ⚠️ ของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) ถูก server ใส่เข้าบิลเสมอ · จอที่บวกแค่ค่าเล่น
  // จะส่งยอดขาดไปเท่ามูลค่าของบน tab แล้ว recordPosSale ทิ้งบิลทั้งใบด้วย PAYMENT_MISMATCH
  // ต่อหน้าลูกค้า · ส่วนลด/คูปองยิ่งห้ามคิดจาก cart อย่างเดียว เพราะฐานจริงรวม tab ด้วย
  assert.match(pos, /export async function previewBoardGamePosPricing/);
  assert.match(pos, /created = await createOrderInTx\(client,/);
  assert.match(pos, /await client\.query\("ROLLBACK"\)/);
  assert.match(route, /boardGameBillingGroupId[\s\S]{0,1600}previewBoardGamePosPricing\(/);
  assert.match(graphql, /boardGameBillingGroupId: ID/);
  assert.match(graphql, /type BmsPosMemberPreviewResult[\s\S]{0,300}amountDue: Float/);

  assert.match(page, /boardGameBillingGroupId: boardGameCheckout\?\.id/);
  assert.match(page, /lines: cart\.map/);
  assert.match(page, /memberPreview\.amountDue/);
  assert.match(page, /ตรวจยอดบิลบอร์ดเกมล่าสุด/);

  assert.match(mobileOperation, /bmsPosMemberPreview[\s\S]{0,300}amountDue/);
  assert.match(mobile, /boardGameBillingGroupId:[\s\S]{0,300}cart\.lines\.map/);
  assert.match(mobile, /boardGamePreview\.amountDue/);
  assert.match(mobile, /boardGamePricing\.refetch\(\)/);

  // totalDue ที่ใช้เป็น fallback ระหว่างรอ preview ยังต้องมาจาก server ไม่ใช่เลขที่จอบวกเอง
  assert.match(page, /boardGameCheckout\?\.totalDue/);
  assert.match(mobile, /boardGameBill\?\.totalDue/);
  assert.match(service, /totalDue: money\(Number\(row\.amount_due\) \+ Number\(row\.tab_amount\)\)/);
});

test("paying one bill never frees a table whose other groups are still playing", () => {
  const pos = read("apps/web/lib/bms/pos.ts");
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  // สูตรตัดสินสถานะโต๊ะมีชุดเดียว — pos.ts ต้องเรียกใช้ ไม่ใช่เขียน UPDATE ของตัวเอง
  assert.match(pos, /refreshSessionFromGroupsInTx\(client, input\.tenantId, sessionId\)/);
  assert.doesNotMatch(pos, /UPDATE bms_board_game_sessions/);
  // สูตรอยู่ในไฟล์ leaf ของตัวเอง (`9.90`) เพื่อไม่ให้ pos.ts กับโมดูลบอร์ดเกม import วนกัน
  const formula = read("apps/web/lib/bms/boardGameSessionStatus.ts");
  assert.doesNotMatch(formula, /^import .* from "\.\/(pos|boardGameCafe|orders)"/m);
  assert.match(service, /from "\.\/boardGameSessionStatus"/);
  assert.match(formula, /WHEN count\(\*\) FILTER \(WHERE g\.status = 'OPEN'\) > 0 THEN 'OPEN'/);
  assert.match(formula, /WHEN count\(\*\) FILTER \(WHERE g\.status = 'CLOSING'\) > 0 THEN 'CLOSING'/);
});

test("board-game service refuses non-board-game tenants before writes", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  assert.match(service, /business_archetype !== "board_game_cafe"/);
  for (const fn of [
    "upsertBoardGameTimeRate",
    "upsertBoardGameArea",
    "upsertBoardGameTable",
    "openBoardGameSession",
    "addBoardGameParticipant",
    "leaveBoardGameParticipant",
    "adjustBoardGameSessionTiming",
    "closeBoardGameBillingGroupForBilling",
    "closeBoardGameSessionForBilling",
    "cancelBoardGameSession",
    "createBoardGameTitle",
    "createBoardGameCopy",
    "checkoutBoardGameCopy",
    "returnBoardGameCopy",
  ]) {
    const start = service.indexOf(`export async function ${fn}`);
    assert.ok(start >= 0, `${fn} is missing`);
    const body = service.slice(start, service.indexOf("\nexport async function", start + 1) < 0
      ? service.length
      : service.indexOf("\nexport async function", start + 1));
    assert.match(body, /requireBoardGameCafeTenant\(client, tenantId\)/, `${fn} does not gate on archetype`);
    assert.match(body, /beginTenantTx\(client, tenantId/, `${fn} is not tenant-scoped`);
  }
  assert.match(service, /ลูกค้าที่คิดค่าเล่นต้องเลือกเรทราคา/);
  assert.match(service, /กรุณารับคืนเกมทุกกล่องก่อนปิดบิล/);
  assert.match(service, /กรุณารับคืนเกมทุกกล่องก่อนปิดบิลสุดท้าย/);
  assert.match(service, /p\.minimum_minutes_snapshot AS minimum_minutes/);
  assert.doesNotMatch(service, /COALESCE\(r\.minimum_minutes/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /replayActionInTx/);
  assert.match(service, /storeActionResultInTx/);
  assert.doesNotMatch(service, /VALUES \(\$1,\$3/);
  assert.match(service, /function booleanOrDefault/);
  assert.match(service, /listLocationsForUser\(tenantId, actorUserId\)/);
  assert.match(service, /locationOfBoardGameSession/);
  assert.match(service, /locationOfBoardGameLoan/);
});

test("board-game API routes are admin guarded and scoped by board-game permissions", () => {
  const routes = new Map([
    ["apps/web/app/api/bms/board-game/locations/route.ts", ["board_game.session.manage"]],
    ["apps/web/app/api/bms/board-game/rates/route.ts", ["board_game.session.manage", "board_game.rate.manage"]],
    ["apps/web/app/api/bms/board-game/floor/route.ts", ["board_game.session.manage", "board_game.floor.manage"]],
    ["apps/web/app/api/bms/board-game/sessions/route.ts", ["board_game.session.manage"]],
    ["apps/web/app/api/bms/board-game/sessions/[id]/route.ts", ["board_game.session.manage"]],
    ["apps/web/app/api/bms/board-game/library/route.ts", ["board_game.library.view", "board_game.library.manage"]],
    ["apps/web/app/api/bms/board-game/library/loans/route.ts", ["board_game.session.manage"]],
    ["apps/web/app/api/bms/board-game/discovery/route.ts", ["board_game.floor.manage"]],
    ["apps/web/app/api/bms/board-game/members/route.ts", ["board_game.session.manage"]],
  ]);
  for (const [file, permissions] of routes) {
    const source = read(file);
    assert.match(source, /authorizeAdminRoute\(/, `${file} does not use admin auth`);
    assert.doesNotMatch(source, /body\.tenantId|searchParams\.get\(["']tenantId["']\)/, `${file} should not accept tenantId from request shape`);
    for (const permission of permissions) {
      const escaped = permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(source, new RegExp(`authorizeAdminRoute\\("${escaped}"\\)`), `${file} lacks ${permission}`);
    }
  }
  const sessionDetailRoute = read("apps/web/app/api/bms/board-game/sessions/[id]/route.ts");
  assert.match(sessionDetailRoute, /requirePermission\(auth\.ctx, "board_game\.session\.override_time"\)/);
  assert.match(sessionDetailRoute, /requirePermission\(auth\.ctx, "board_game\.session\.cancel"\)/);
  assert.match(sessionDetailRoute, /canAccessBoardGameLocation/);
  const access = read("apps/web/app/api/bms/board-game/access.ts");
  assert.match(access, /userCanAccessLocation\(actor\.tenantId, String\(actor\.adminId\), locationId\)/);
  for (const file of [
    "apps/web/app/api/bms/board-game/floor/route.ts",
    "apps/web/app/api/bms/board-game/sessions/route.ts",
    "apps/web/app/api/bms/board-game/library/route.ts",
    "apps/web/app/api/bms/board-game/library/loans/route.ts",
  ]) {
    assert.match(read(file), /canAccessBoardGameLocation/, `${file} does not enforce branch scope`);
  }
});

test("public board-game discovery is explicit, aggregate-only and rate limited", () => {
  const sql = read("db/migrations/9.83__bms_board_game_public_discovery.sql");
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const publicRoute = read("apps/web/app/api/board-game/nearby/route.ts");
  const adminRoute = read("apps/web/app/api/bms/board-game/discovery/route.ts");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_public_locations/);
  assert.match(sql, /public_visible\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /NOT public_visible OR \(latitude IS NOT NULL AND longitude IS NOT NULL\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /TO bms_app/);
  assert.match(service, /profile\.public_visible AND location\.active/);
  assert.match(service, /store\.business_archetype = 'board_game_cafe'/);
  assert.match(service, /title\.public_visible/);
  // ตัดเฉพาะตัวฟังก์ชัน ไม่ใช่ตั้งแต่ตรงนั้นจนจบไฟล์ — ของที่เขียนทีหลังในไฟล์เดียวกัน
  // (เช่นแพ็กเกจสมาชิกที่อ่าน customer_id) จะทำให้ด่านนี้แดงด้วยเหตุผลที่ไม่ใช่ของมัน
  const publicFn = functionBody(service, /export async function listPublicBoardGameCafes\(/);
  // `9.91`: โต๊ะว่างตัดสินจาก "ที่นั่ง" ไม่ใช่จาก session — หลังรวมโต๊ะ session หลายก้อนนั่งที่เดียวกัน
  // การนับจาก session จึงบอกคนนอกร้านว่าโต๊ะว่างทั้งที่มีคนนั่งอยู่
  assert.match(
    publicFn,
    /NOT EXISTS \(\s*SELECT 1 FROM bms_board_game_seatings[\s\S]{0,400}?seating\.status = 'ACTIVE'/,
    "public availability must exclude tables held by an active seating"
  );
  assert.doesNotMatch(
    publicFn,
    /session\.status IN/,
    "occupancy is the seating's, not the session's"
  );
  assert.doesNotMatch(publicFn, /customer_id|display_name AS customer/i);
  assert.match(publicRoute, /rateLimit\(`/);
  assert.doesNotMatch(publicRoute, /authorizeAdminRoute/);
  assert.match(adminRoute, /authorizeAdminRoute\("board_game\.floor\.manage"\)/);
  assert.match(adminRoute, /canAccessBoardGameLocation/);
});

test("board-game member rates resolve an existing CRM member without exposing broad PII", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const route = read("apps/web/app/api/bms/board-game/members/route.ts");
  const page = read("apps/web/app/(admin)/admin/board-game/page.tsx");

  assert.match(service, /type === "MEMBER" && !customerId/);
  assert.match(service, /customer\.rows\[0\]\.member_no/);
  assert.match(route, /searchMembers\(auth\.tenantId, search, 10\)/);
  assert.match(route, /customerId: member\.customerId/);
  assert.match(route, /memberNo: member\.memberNo/);
  assert.doesNotMatch(route, /phone:|email:|address:|national/i);
  assert.match(page, /name=\{\[field\.name, "customerId"\]\}/);
  assert.match(page, /customerType === "MEMBER" \? <Form\.Item/);
  assert.doesNotMatch(page, /participantType: firstRate/);
});

test("POS board-game checkout read is device and branch scoped", () => {
  const route = read("apps/web/app/api/pos/board-game/session/route.ts");
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  assert.match(route, /authenticatePosDevice/);
  assert.doesNotMatch(route, /tenantId.*searchParams|body\.tenantId/);
  // บิลที่รอเก็บเงินคีย์ด้วย **กลุ่ม** (`9.89`) ไม่ใช่โต๊ะ — โต๊ะที่แยกบิลมีหลายใบรออยู่พร้อมกัน
  assert.match(service, /g\.tenant_id = \$1 AND g\.location_id = \$2 AND g\.id = \$3/);
  // บิลที่ปิดแล้วและมีของบน tab ยังถือใบจองอยู่ — เงื่อนไขจึงเป็นสถานะ ไม่ใช่ช่องออร์เดอร์ที่ว่าง
  assert.match(service, /g\.status = 'CLOSING'`/);
  assert.match(service, /locationOfBoardGameBillingGroup/);
});

test("board-game billable minutes apply grace, rounding and minimum time", () => {
  const startedAt = "2026-09-13T10:00:00.000Z";
  assert.equal(boardGameBillableMinutes({
    startedAt,
    endedAt: "2026-09-13T10:05:00.000Z",
    minimumMinutes: 60,
    roundingMinutes: 30,
    graceMinutes: 10,
  }), 60);
  assert.equal(boardGameBillableMinutes({
    startedAt,
    endedAt: "2026-09-13T11:11:00.000Z",
    minimumMinutes: 0,
    roundingMinutes: 30,
    graceMinutes: 10,
  }), 90);
  assert.equal(boardGameBillableMinutes({
    startedAt,
    endedAt: "2026-09-13T12:01:00.000Z",
    minimumMinutes: 60,
    roundingMinutes: 15,
    graceMinutes: 0,
  }), 135);
});

test("board-game fake data covers the operator surface and cleans up in dependency order", () => {
  const seed = read("apps/web/lib/bms/devSeed.ts");
  const route = read("apps/web/app/api/dev/fake/bms-board-game/route.ts");
  const page = read("apps/web/app/(admin)/admin/dev/fake/page.tsx");
  const cleanup = read("apps/web/app/api/dev/fake/cleanup/route.ts");
  const devCleanup = read("apps/web/lib/bms/devCleanup.ts");
  const provision = read("apps/web/app/api/dev/fake/provision-shop/route.ts");

  assert.match(seed, /export async function seedFakeBoardGameCafe/);
  for (const fixture of [
    "bms_board_game_areas",
    "bms_board_game_tables",
    "bms_board_game_time_rates",
    "bms_board_game_sessions",
    "bms_board_game_session_participants",
    "bms_board_game_titles",
    "bms_board_game_copies",
    "bms_board_game_session_games",
    "bms_board_game_public_locations",
  ]) {
    assert.match(seed, new RegExp(fixture), `${fixture} is missing from board-game fixtures`);
  }
  assert.match(seed, /"OPEN"/);
  assert.match(seed, /"CLOSING"/);
  assert.match(seed, /'RETURNED'/);
  assert.match(seed, /'ISSUE'/);
  assert.match(seed, /billingGroupNo/);
  assert.match(route, /requirePlatformAdminSeeder/);
  assert.match(route, /fakeSeedDisabled/);
  assert.match(route, /seedFakeMembers/);
  assert.match(page, /value: 'bms-board-game'/);
  assert.match(provision, /businessArchetype === "board_game_cafe"/);
  assert.ok(
    cleanup.indexOf("resBoardGameOrders") < cleanup.indexOf("resBoardGameSessions"),
    "cleanup must remove linked POS orders before board-game sessions"
  );
  assert.ok(
    cleanup.indexOf("resBoardGameSessions") < cleanup.indexOf("resBoardGameCopies"),
    "cleanup must remove session loans before game copies"
  );
  assert.match(cleanup, /deleteUnreferencedFakeUsers\(tenantId\)/);
  assert.match(devCleanup, /FOR UPDATE/);
  assert.match(devCleanup, /SAVEPOINT delete_fake_user/);
  assert.match(devCleanup, /error\?\.code !== "23503"/);
  assert.match(cleanup, /usersSkippedReferenced/);
});

test("public roadmap reflects completed board-game work and current mobile rollout", () => {
  const roadmap = read("apps/web/app/(main)/roadmap/page.tsx");
  assert.match(roadmap, /id: "vertical-operations"/);
  assert.match(roadmap, /quarter: "Q5 - Board game cafe"[\s\S]{0,180}status: "done"/);
  assert.match(roadmap, /quarter: "Q6 - POS mobile"[\s\S]{0,180}status: "in_progress"/);
  assert.match(roadmap, /quarter: "Q5 - ร้านบอร์ดเกมคาเฟ่"[\s\S]{0,220}status: "done"/);
  assert.match(roadmap, /quarter: "Q6 - POS มือถือ"[\s\S]{0,220}status: "in_progress"/);
});

/**
 * `9.91` แยก "ที่นั่ง" ออกจาก "visit" — ชุด DB พิสูจน์พฤติกรรมจริง แต่ `gate.yml` รันเฉพาะชุด pure
 * ตัวเหล่านี้จึงเป็นด่านเดียวที่ยิงทุก PR · ตรึงกติกา ไม่ใช่รูปทรงของ SQL
 */
function functionBody(source: string, signature: RegExp): string {
  const at = signature.exec(source);
  assert.ok(at, `expected to find ${signature}`);
  // ข้ามลิสต์พารามิเตอร์ก่อน ไม่งั้น `{ idempotencyKey: string }` ของ input จะถูกอ่านว่าเป็นตัวฟังก์ชัน
  // แล้วเทสทั้งชุดจะเขียว/แดงโดยไม่เคยเห็นโค้ดที่กำลังตรึงอยู่เลย
  let paren = 0;
  let cursor = source.indexOf("(", at!.index);
  assert.ok(cursor > 0, `expected a parameter list for ${signature}`);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === "(") paren += 1;
    else if (source[cursor] === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  const open = source.indexOf("{", cursor);
  assert.ok(open > 0, `expected a body for ${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unbalanced body for ${signature}`);
}

test("`9.91` gives the table to a seating and retires the one-session-per-table index", () => {
  const sql = read("db/migrations/9.91__bms_board_game_seatings.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_board_game_seatings/);
  assert.match(sql, /ALTER TABLE bms_board_game_seatings ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE bms_board_game_seatings FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_seatings TO bms_app/);
  assert.match(sql, /create_revision_trigger\('bms_board_game_seatings'\)/);

  // โต๊ะเป็นของที่นั่ง ไม่ใช่ของ visit — ดัชนีเดิมบังคับ "หนึ่งโต๊ะหนึ่ง session" ซึ่งทำให้รวมโต๊ะไม่ได้เลย
  assert.match(
    sql,
    /CREATE UNIQUE INDEX[^;]*uq_bms_board_game_seatings_active_table[\s\S]*?\(tenant_id, table_id\)[\s\S]*?WHERE status = 'ACTIVE'/,
  );
  assert.match(sql, /DROP INDEX IF EXISTS uq_bms_board_game_sessions_open_table/);

  // session ต้องชี้ที่นั่งของตัวเองเสมอ และที่นั่งนั้นต้องอยู่สาขาเดียวกัน
  assert.match(sql, /ADD COLUMN IF NOT EXISTS seating_id UUID/);
  assert.match(sql, /ALTER COLUMN seating_id SET NOT NULL/);
  assert.match(
    sql,
    /FOREIGN KEY \(tenant_id, location_id, seating_id\)\s*\n?\s*REFERENCES bms_board_game_seatings\(tenant_id, location_id, id\)/,
  );
  assert.match(sql, /VALIDATE CONSTRAINT bms_board_game_sessions_seating_location_fk/);
});

test("a board-game table is free only when no seating is active on it", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");

  // เปิดโต๊ะทับต้องถูกกันด้วย "ที่นั่ง" — session ตัดสินไม่ได้แล้ว เพราะโต๊ะที่รวมไว้มีหลาย session
  const open = functionBody(service, /export async function openBoardGameSession\(/);
  assert.match(
    open,
    /FROM bms_board_game_seatings[\s\S]*?status = 'ACTIVE'[\s\S]*?FOR UPDATE/,
    "opening must read the destination table's active seating",
  );
  // การอ่านอย่างเดียวไม่ใช่ด่าน — ผลของมันต้องเป็นตัวปฏิเสธจริง ๆ ไม่งั้นเทสเขียวกับโค้ดที่
  // ถาม แล้วทิ้งคำตอบ ซึ่งเป็นกับดักเดิมของเทสสแกนซอร์สในรีโปนี้
  assert.match(
    open,
    /if \(occupied\.rowCount\) throw new Error\(/,
    "the answer must reject the open, not merely be read",
  );
  assert.doesNotMatch(
    open,
    /FROM bms_board_game_sessions[\s\S]*?status IN \('OPEN'/,
    "occupancy is the seating's, not the session's",
  );
  // ล็อกแถวโต๊ะก่อน แล้วค่อยดูว่ามีที่นั่งไหม — ไม่งั้นการย้ายโต๊ะแทรกระหว่างตรวจกับเขียนได้
  assert.ok(
    open.indexOf("FROM bms_board_game_tables") < open.indexOf("FROM bms_board_game_seatings"),
    "the destination table row must be locked before its occupancy is read",
  );

  const floor = functionBody(service, /export async function listBoardGameFloor\(/);
  assert.match(floor, /JOIN bms_board_game_seatings st[\s\S]*?st\.status = 'ACTIVE'/);
});

test("moving or merging a board-game table never touches money, time or players", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const relocate = functionBody(service, /async function relocateBoardGameSeating\(/);

  // ทั้งหมดของ `9.91` คือ "เปลี่ยนที่นั่ง ไม่เปลี่ยนบิล" — เขียนตารางเงินเมื่อไรคือคนละฟีเจอร์
  for (const forbidden of [
    "bms_board_game_billing_groups",
    "bms_board_game_group_items",
    "bms_orders",
    "bms_board_game_session_participants",
    "charge_snapshot",
    "amount_due",
    "started_at",
    "expected_end_at",
  ]) {
    assert.ok(
      !relocate.includes(forbidden),
      `relocating a seating must not read or write ${forbidden}`,
    );
  }
  // คอลัมน์เดียวของ session ที่ถูกแตะคือ "ตอนนี้นั่งที่ไหน"
  const sessionWrites = [...relocate.matchAll(/UPDATE bms_board_game_sessions\s*\n?\s*SET ([a-z_]+)/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(sessionWrites)], ["seating_id"]);
});

test("move and merge refuse each other's job instead of guessing", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const relocate = functionBody(service, /async function relocateBoardGameSeating\(/);

  // การเดาแทนคนกดคือการย้ายลูกค้าที่เขาไม่ได้เลือก · สองทางนี้ต้องปฏิเสธกันและกันตรง ๆ
  assert.match(
    relocate,
    /if \(action === "move" && destination\.rowCount\) \{\s*\n\s*throw new Error\(/,
  );
  assert.match(
    relocate,
    /if \(action === "merge" && !destination\.rowCount\) \{\s*\n\s*throw new Error\(/,
  );
  assert.match(relocate, /table_id === targetTableId[\s\S]{0,120}throw new Error\(/);
  // ทั้งร้านมีล็อกผังใบเดียว ไม่งั้น A→B กับ B→A พร้อมกันจะวนรอกัน
  assert.match(relocate, /pg_advisory_xact_lock[\s\S]{0,160}seating-floor/);
});

test("merging a board-game table is not a one-way door", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const relocate = functionBody(service, /async function relocateBoardGameSeating\(/);

  // โต๊ะที่รวมไว้มีหลายชุด — ย้ายต้องแยกเฉพาะชุดที่เลือก ไม่งั้นกดจากการ์ดของชุดหนึ่งจะลากอีกชุดไปด้วย
  const detach = relocate.slice(relocate.indexOf('action === "move" && sourceSessionIds.length > 1'));
  assert.ok(detach.length > 0, "move must special-case a seating that several sessions share");
  assert.match(detach, /INSERT INTO bms_board_game_seatings/);
  assert.match(detach, /movedSessionIds = \[sessionId\]/);
  assert.match(
    detach,
    /WHERE tenant_id = \$1 AND id = \$2`,\s*\n\s*\[tenantId, sessionId, movedSeatingId\]/,
    "only the selected session may be re-seated",
  );
});

test("the seating status formula lives once, next to the session's", () => {
  const status = read("apps/web/lib/bms/boardGameSessionStatus.ts");
  const service = read("apps/web/lib/bms/boardGameCafe.ts");

  // ที่นั่งว่างเมื่อทุก session ที่ยังผูกอยู่จบแล้ว — สูตรสองชุดจะเริ่มเถียงกันว่าโต๊ะเปิดใหม่ได้หรือยัง
  assert.match(status, /export async function refreshBoardGameSeatingInTx\(/);
  assert.match(
    status,
    /s\.status IN \('OPEN', 'CLOSING'\)[\s\S]*?THEN 'ACTIVE' ELSE 'CLOSED' END/,
  );
  assert.match(status, /AND st\.status <> 'MERGED'/, "a merged seating is history and never reopens");
  // ปิดกลุ่มสุดท้ายของ session แล้วที่นั่งต้องถูกคิดใหม่เองจากสูตรเดียวกัน — ทุกผู้เรียกรวมถึง pos.ts
  assert.match(status, /RETURNING s\.seating_id/);
  assert.match(status, /if \(seatingId\) await refreshBoardGameSeatingInTx\(/);

  // การเขียนสถานะที่นั่งนอกสูตรมีได้ทางเดียว: ปิดที่นั่งต้นทางเป็น MERGED ตอนรวมโต๊ะ
  const derived = [...service.matchAll(/UPDATE bms_board_game_seatings\s*\n?\s*SET ([a-z_]+ = [^,\n]+)/g)]
    .map((match) => match[1].trim());
  assert.deepEqual(
    derived.filter((assignment) => assignment.startsWith("status")),
    ["status = 'MERGED'"],
  );
});

test("`10.7` persists participant time and merged-group history", () => {
  const sql = read("db/migrations/10.7__bms_board_game_flexible_groups.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS time_mode TEXT NOT NULL DEFAULT 'ACTUAL'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS planned_end_at TIMESTAMPTZ/);
  assert.match(sql, /time_mode IN \('ACTUAL', 'SESSION_END', 'DURATION'\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS merged_into_group_id UUID/);
  assert.match(sql, /status IN \('OPEN', 'CLOSING', 'PAID', 'CANCELLED', 'MERGED'\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, merged_into_group_id\)/);
});

test("capacity overrides and personal time are server rules, not UI-only hints", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const waitlist = read("apps/web/lib/bms/boardGameWaitlist.ts");
  const open = functionBody(service, /export async function openBoardGameSession\(/);
  const add = functionBody(service, /export async function addBoardGameParticipant\(/);
  const relocate = functionBody(service, /async function relocateBoardGameSeating\(/);

  for (const body of [open, add, relocate]) {
    assert.match(body, /allowOverCapacity/);
    assert.match(body, /seats/);
  }
  assert.match(waitlist, /input\.allowOverCapacity !== true/);
  assert.match(add, /ps\.seating_id = \$2/);
  assert.ok(
    add.indexOf("FOR UPDATE") < add.indexOf("SELECT count(*)::int AS active_guests"),
    "capacity must be counted after the shared seating/table lock is acquired",
  );
  assert.match(service, /timeMode === "DURATION"[\s\S]{0,260}purchasedDurationMinutes/);
  assert.match(service, /WHEN p\.planned_end_at > COALESCE\(p\.left_at, \$3::timestamptz\)/);
  assert.match(service, /AND time_mode = 'SESSION_END'/);
  assert.match(service, /next_participant_end_at/);
});

test("open billing groups can merge or detach without rewriting frozen bills", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const merge = functionBody(service, /export async function mergeBoardGameBillingGroups\(/);
  const detach = functionBody(service, /export async function detachBoardGameBillingGroupToTable\(/);

  assert.match(merge, /source\.status !== "OPEN" \|\| target\.status !== "OPEN"/);
  assert.ok(
    merge.indexOf("FROM bms_board_game_sessions") < merge.indexOf("ORDER BY id FOR UPDATE"),
    "group merge must lock session before groups",
  );
  assert.ok(
    merge.indexOf("ORDER BY id FOR UPDATE") < merge.indexOf("FROM bms_pos_shifts"),
    "group merge must keep the tab reservation lock order: groups before shift",
  );
  assert.match(merge, /UPDATE bms_board_game_group_items[\s\S]*billing_group_id = \$3[\s\S]*status = 'ACTIVE'/);
  assert.match(merge, /UPDATE bms_board_game_session_participants[\s\S]*billing_group_id = \$3/);
  assert.match(merge, /status = 'MERGED', merged_into_group_id = \$3/);
  assert.ok(
    [...merge.matchAll(/rebuildGroupReservationInTx\(/g)].length >= 2,
    "both source and destination reservations must be rebuilt",
  );

  assert.match(detach, /id <> \$3 AND status IN \('OPEN','CLOSING'\)/);
  assert.ok(
    detach.indexOf("FROM bms_board_game_sessions") < detach.indexOf("session_id = $3 AND status = 'OPEN'"),
    "group detach must lock session before its group",
  );
  assert.match(detach, /INSERT INTO bms_board_game_seatings/);
  assert.match(detach, /INSERT INTO bms_board_game_sessions/);
  assert.match(detach, /UPDATE bms_board_game_billing_groups SET session_id = \$3/);
  assert.match(detach, /UPDATE bms_orders SET board_game_session_id = \$3/);
  assert.match(detach, /if \(!movedOrder\.rowCount\)/);
  assert.match(detach, /บัตรที่ผูกกับเกมต้องย้ายพร้อมเกมกล่องนั้น/);
  assert.match(detach, /loanIds/);
  assert.match(detach, /identityHoldIds/);
});
