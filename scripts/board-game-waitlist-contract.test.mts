import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const migration = read("db/migrations/9.99__bms_board_game_waitlist.sql");
const reservationMigration = read("db/migrations/10.0__bms_board_game_advance_reservations.sql");
const service = read("apps/web/lib/bms/boardGameWaitlist.ts");
const cafe = read("apps/web/lib/bms/boardGameCafe.ts");
const operations = read("apps/web/lib/bms/boardGamePosOperations.ts");
const graphql = read("apps/web/graphql/bmsPosDevice.ts");
const browser = read("apps/web/components/pos/BoardGamePanel.tsx");
const mobile = read("apps/mobile/src/screens/boardGame/BoardGameScreen.tsx");
const cleanup = read("apps/web/app/api/dev/fake/cleanup/route.ts");
const platform = read("apps/web/lib/bms/platform.ts");
const dbContract = read("scripts/board-game-waitlist-db-contract.test.mts");

test("9.99 stores one tenant/branch service-day queue with honest terminal shapes", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_waitlist/);
  assert.match(migration, /UNIQUE \(tenant_id, location_id, service_date, queue_no\)/);
  assert.match(migration, /'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'/);
  assert.match(migration, /status = 'SEATED'[\s\S]*seated_table_id IS NOT NULL[\s\S]*seated_session_id IS NOT NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /create_revision_trigger\('bms_board_game_waitlist'\)/);
  assert.match(migration, /'board_game\.waitlist\.changed'/);
});

test("seating a queue row and opening the real session share one transaction", () => {
  assert.match(service, /beginTenantTx\(client, input\.tenantId/);
  assert.match(service, /SELECT party_size, reserved_table_id FROM bms_board_game_waitlist[\s\S]*FOR UPDATE/);
  assert.match(service, /openBoardGameSessionInTx\(client, input\.tenantId/);
  assert.match(service, /SET status = 'SEATED'[\s\S]*seated_session_id = \$5/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(cafe, /export function openBoardGameSessionInTx/);
  assert.doesNotMatch(service, /INSERT INTO bms_board_game_sessions/,
    "the queue must reuse the normal open-session path, not copy its SQL");
});

test("10.0 adds a future table window without creating another session or money path", () => {
  assert.match(reservationMigration, /ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'WALK_IN'/);
  assert.match(reservationMigration, /'CONFIRMED', 'WAITING', 'CALLED', 'SEATED'/);
  assert.match(reservationMigration, /reserved_duration_minutes BETWEEN 30 AND 720/);
  assert.match(reservationMigration, /bms_board_game_waitlist_reserved_table_fk/);
  assert.match(service, /board-game-reservation:\$\{input\.tenantId\}:\$\{input\.locationId\}:\$\{input\.tableId\}/);
  assert.match(service, /reserved_for < \$4::timestamptz \+ make_interval/);
  assert.match(service, /status = 'WAITING', checked_in_at = now\(\)/);
  assert.match(service, /โต๊ะนี้ยังมี session ที่ยืนยันไม่ได้ว่าจะจบก่อนเวลาจอง/);
  assert.doesNotMatch(service, /INSERT INTO bms_payments|INSERT INTO bms_orders/,
    "a table reservation must not invent a second payment or order path");
});

test("queue mutations stay in the shared POS command table and both registers expose them", () => {
  for (const action of ["waitlist.add", "waitlist.call", "waitlist.close", "waitlist.seat"]) {
    assert.match(operations, new RegExp(`"${action.replace(".", "\\.")}"`));
  }
  for (const action of ["reservation.add", "reservation.check_in"]) {
    assert.match(operations, new RegExp(`"${action.replace(".", "\\.")}"`));
  }
  for (const mutation of [
    "bmsPosAddBoardGameWaitlistEntry", "bmsPosCallBoardGameWaitlistEntry",
    "bmsPosCloseBoardGameWaitlistEntry", "bmsPosSeatBoardGameWaitlistEntry",
    "bmsPosAddBoardGameReservation", "bmsPosCheckInBoardGameReservation",
  ]) {
    assert.match(graphql, new RegExp(mutation));
  }
  assert.match(browser, /action: string/);
  assert.match(browser, /'waitlist\.add'/);
  assert.match(browser, /'waitlist\.seat'/);
  assert.match(mobile, /MobilePosAddBoardGameWaitlistEntryDocument/);
  assert.match(mobile, /MobilePosSeatBoardGameWaitlistEntryDocument/);
  assert.match(browser, /'reservation\.add'/);
  assert.match(browser, /'reservation\.check_in'/);
  assert.match(mobile, /MobilePosAddBoardGameReservationDocument/);
  assert.match(mobile, /MobilePosCheckInBoardGameReservationDocument/);
});

test("availability is capacity-aware guidance, not a promise", () => {
  assert.match(service, /t\.seats/);
  assert.match(service, /expected_available_at/);
  assert.match(service, /st\.status = 'ACTIVE'/);
  assert.match(service, /SELECT seats FROM bms_board_game_tables[\s\S]*FOR UPDATE/);
  assert.match(service, /โต๊ะนี้รองรับจำนวนผู้เล่นจริงไม่พอ/);
  assert.match(browser, /table\.seats >= entry\.partySize/);
  assert.match(mobile, /table\.seats >= entry\.partySize/);
});

test("queue history is removed before sessions during fixture and test-tenant cleanup", () => {
  assert.ok(
    cleanup.indexOf("DELETE FROM bms_board_game_waitlist") <
      cleanup.indexOf("DELETE FROM bms_board_game_sessions"),
  );
  assert.ok(
    platform.indexOf("DELETE FROM bms_board_game_waitlist") <
      platform.indexOf("DELETE FROM bms_board_game_sessions"),
  );
});

test("the DB suite exercises concurrency, rollback and the atomic link", () => {
  assert.match(dbContract, /Promise\.all\(\[add\(2\), add\(3\), add\(4\), add\(5\)\]\)/);
  assert.match(dbContract, /isIdempotencyConflictError/);
  assert.match(dbContract, /รองรับจำนวนผู้เล่นจริงไม่พอ/);
  assert.match(dbContract, /queue_status: "SEATED", session_status: "OPEN"/);
  assert.match(dbContract, /node scripts\/run-contract-tests\.mjs db board-game-waitlist/);
});
