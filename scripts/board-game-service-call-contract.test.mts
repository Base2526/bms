import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) =>
  readFile(path.join(repo, relative), "utf8");

test("board-game calls are additive operational work, never time, bill, stock, or game-copy writes", async () => {
  const migration = await read(
    "db/migrations/9.96__bms_board_game_service_calls.sql",
  );
  const service = await read("apps/web/lib/bms/boardGameServiceCalls.ts");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_guest_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_service_calls/);
  assert.doesNotMatch(
    service,
    /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:bms_board_game_billing_groups|bms_board_game_tab_items|bms_board_game_game_loans|bms_inventory|bms_orders)\b/i,
  );
  assert.doesNotMatch(
    service,
    /(?:adjustBoardGameSessionTiming|closeBoardGameBillingGroup|checkoutBoardGameCopy|returnBoardGameCopy|recordPosSale)/,
  );
  assert.match(
    migration,
    /IF NEW\.status IN \('PAID', 'CANCELLED'\) AND OLD\.status IS DISTINCT FROM NEW\.status/,
    "closing an existing session may only expire its guest token and outstanding calls",
  );
  assert.match(
    migration,
    /AFTER UPDATE OF status ON bms_board_game_sessions[\s\S]*bms_board_game_expire_guest_calls\(\)/,
  );
});

test("board-game guest and staff call paths stay session, tenant, branch, and permission scoped", async () => {
  const service = await read("apps/web/lib/bms/boardGameServiceCalls.ts");
  const operations = await read(
    "apps/web/lib/bms/boardGamePosOperations.ts",
  );
  const routeHelpers = await read(
    "apps/web/app/api/bms/board-game-guest/routeHelpers.ts",
  );
  const guestRoute = await read(
    "apps/web/app/api/bms/board-game-guest/service-calls/route.ts",
  );

  assert.match(
    service,
    /session\.tenant_id = \$1 AND session\.location_id = \$2 AND session\.id = \$3[\s\S]*session\.status = 'OPEN' AND seating\.status = 'ACTIVE'/,
  );
  assert.match(
    service,
    /WHERE call\.tenant_id = \$1 AND call\.location_id = \$2/,
  );
  assert.match(
    operations,
    /"service\.access": \{[\s\S]{0,180}permission: "board_game\.session\.manage"/,
  );
  assert.match(
    operations,
    /"service\.acknowledge": \{[\s\S]{0,180}permission: "board_game\.session\.manage"/,
  );
  assert.match(
    operations,
    /"service\.complete": \{[\s\S]{0,180}permission: "board_game\.session\.manage"/,
  );
  assert.match(routeHelpers, /rateLimit\(/);
  assert.match(routeHelpers, /createHash\("sha256"\)/);
  assert.match(guestRoute, /requireBoardGameGuestRateLimit\(req, "submit", 6\)/);
});

test("board-game service-call storage has isolation, replay, expiry, and realtime contracts", async () => {
  const migration = await read(
    "db/migrations/9.96__bms_board_game_service_calls.sql",
  );
  const service = await read("apps/web/lib/bms/boardGameServiceCalls.ts");

  for (const table of [
    "bms_board_game_guest_tokens",
    "bms_board_game_service_calls",
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`create_revision_trigger\\('${table}'\\)`));
  }
  assert.match(
    migration,
    /UNIQUE \(tenant_id, guest_token_id, idempotency_key\)/,
  );
  assert.match(
    migration,
    /WHERE status IN \('PENDING', 'ACKNOWLEDGED'\)/,
  );
  assert.match(
    migration,
    /'board_game\.table_call\.created'[\s\S]*'board_game\.table_call\.status_changed'/,
  );
  assert.match(service, /replayed: true/);
  assert.match(
    migration,
    /request_note[\s\S]{0,160}length\(btrim\(request_note\)\)/,
  );
});
