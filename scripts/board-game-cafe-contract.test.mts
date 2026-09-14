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

test("board-game payment reuses POS and atomically links the paid session", () => {
  const sql = read("db/migrations/9.82__bms_board_game_pos_settlement.sql");
  const orders = read("apps/web/lib/bms/orders.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const restRoute = read("apps/web/app/api/pos/sale/route.ts");
  const graphql = read("apps/web/graphql/bmsPosDevice.ts");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS board_game_session_id UUID/);
  assert.match(sql, /uq_bms_orders_active_board_game_session/);
  assert.match(sql, /status IN \('PENDING', 'PAID', 'COMPLETED'\)/);
  assert.match(sql, /restaurant_check_id IS NULL OR board_game_session_id IS NULL/);
  assert.match(orders, /charge_snapshot/);
  assert.match(orders, /status = 'CLOSING' AND current_order_id IS NULL/);
  assert.match(orders, /Board game time \/ ค่าเล่นบอร์ดเกม/);
  assert.match(orders, /boardGameSessionId\]\s*\)/);
  assert.match(pos, /SET status = 'PAID', current_order_id = \$3/);
  assert.match(pos, /board_game\.session_paid/);
  assert.match(pos, /session บอร์ดเกมไม่พร้อมรับชำระหรือถูกบิลอื่นชำระแล้ว/);
  assert.match(restRoute, /lines\.length === 0 && !boardGameSessionId/);
  assert.match(graphql, /boardGameSessionId: ID/);
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
  assert.match(service, /session\.status IN \('OPEN', 'CLOSING'\)/);
  assert.match(service, /title\.public_visible/);
  assert.doesNotMatch(
    service.slice(service.indexOf("export async function listPublicBoardGameCafes")),
    /customer_id|display_name AS customer/i
  );
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
  assert.match(service, /s\.tenant_id = \$1 AND s\.location_id = \$2 AND s\.id = \$3/);
  assert.match(service, /s\.status = 'CLOSING' AND s\.current_order_id IS NULL/);
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
});

test("public roadmap reflects completed board-game work and current mobile rollout", () => {
  const roadmap = read("apps/web/app/(main)/roadmap/page.tsx");
  assert.match(roadmap, /id: "vertical-operations"/);
  assert.match(roadmap, /quarter: "Q5 - Board game cafe"[\s\S]{0,180}status: "done"/);
  assert.match(roadmap, /quarter: "Q6 - POS mobile"[\s\S]{0,180}status: "in_progress"/);
  assert.match(roadmap, /quarter: "Q5 - ร้านบอร์ดเกมคาเฟ่"[\s\S]{0,220}status: "done"/);
  assert.match(roadmap, /quarter: "Q6 - POS มือถือ"[\s\S]{0,220}status: "in_progress"/);
});
