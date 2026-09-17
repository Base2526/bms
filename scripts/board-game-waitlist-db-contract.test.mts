/**
 * Board-game walk-in queue (`9.99`) against a real Postgres.
 *
 * The pure contract pins the architecture. This suite proves the parts that only the database can:
 * concurrent queue-number allocation, replay/conflict behaviour, branch scope, capacity rollback,
 * and the atomic WAITING -> SEATED + real session transition.
 *
 * ⚠️ Writes to the configured database. It creates and removes its own tenant; never run against
 * production. Use the guarded runner: `node scripts/run-contract-tests.mjs db board-game-waitlist`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { isIdempotencyConflictError } from "../apps/web/lib/bms/idempotencyErrors.ts";
import {
  addBoardGameReservation,
  addBoardGameWaitlistEntry,
  callBoardGameWaitlistEntry,
  checkInBoardGameReservation,
  closeBoardGameWaitlistEntry,
  listBoardGameWaitlist,
  seatBoardGameWaitlistEntry,
  updateBoardGameReservation,
} from "../apps/web/lib/bms/boardGameWaitlist.ts";

const TAG = "bg-waitlist-test";
let tenantId = "";
let locationId = "";
let otherLocationId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
let rateId = "";
let smallTableId = "";
let largeTableId = "";
let sequence = 0;

const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++sequence}`;
const players = (count: number) => Array.from({ length: count }, (_, index) => ({
  rateId,
  displayName: `FAKE player ${index + 1}`,
  participantType: "GENERAL" as const,
  billingGroupNo: 1,
}));

async function add(partySize: number, idempotencyKey = key("add")) {
  return addBoardGameWaitlistEntry({
    tenantId,
    locationId,
    actorUserId: staffId,
    idempotencyKey,
    partySize,
    guestName: `FAKE party ${sequence}`,
    preferredAreaId: areaId,
  });
}

const futureIso = (hours: number) => new Date(Date.now() + hours * 60 * 60_000).toISOString();

async function reserve(tableId: string, reservedFor: string, partySize = 2) {
  return addBoardGameReservation({
    tenantId, locationId, actorUserId: staffId, idempotencyKey: key("reserve"),
    tableId, reservedFor, durationMinutes: 120, partySize,
    guestName: `FAKE reservation ${sequence}`, guestPhone: "0800000000",
  });
}

test("setup: a throwaway board-game cafe with two table capacities", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${Date.now()}`],
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`],
  )).rows[0].id;
  otherLocationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
     VALUES ($1,'BR2',$2,'00002',FALSE) RETURNING id`,
    [tenantId, `FAKE ${TAG} branch 2`],
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype, timezone)
     VALUES ($1,'board_game_cafe','Asia/Bangkok')`,
    [tenantId],
  );
  staffId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} staff`, `fake-${TAG}-${Date.now()}@example.invalid`],
  )).rows[0].id;
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-1',$3) RETURNING id`,
    [tenantId, locationId, `FAKE ${TAG} device`],
  )).rows[0].id;
  shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`,
    [tenantId, locationId, deviceId, staffId],
  )).rows[0].id;
  areaId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_areas (tenant_id, location_id, name)
     VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, locationId, `FAKE ${TAG} zone`],
  )).rows[0].id;
  const tables = await query<{ id: string; seats: number }>(
    `INSERT INTO bms_board_game_tables
       (tenant_id, location_id, area_id, code, name, seats, sort_order)
     VALUES ($1,$2,$3,'FAKE-SMALL',$4,2,1),
            ($1,$2,$3,'FAKE-LARGE',$5,6,2)
     RETURNING id, seats`,
    [tenantId, locationId, areaId, `FAKE ${TAG} small`, `FAKE ${TAG} large`],
  );
  smallTableId = tables.rows.find((row) => Number(row.seats) === 2)!.id;
  largeTableId = tables.rows.find((row) => Number(row.seats) === 6)!.id;
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes,
        rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_GENERAL',$2,'GENERAL',60,60,30,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`],
  )).rows[0].id;
});

test("concurrent arrivals get one increasing branch/service-day sequence", async () => {
  const entries = await Promise.all([add(2), add(3), add(4), add(5)]);
  assert.deepEqual(
    entries.map((entry) => entry!.queueNo).sort((left, right) => left - right),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(entries.map((entry) => entry!.serviceDate)).size, 1);
  const board = await listBoardGameWaitlist(tenantId, locationId);
  assert.equal(board.waitingCount, 4);
  assert.equal(board.waitingGuests, 14);
  assert.deepEqual(board.tables.map((table) => table.availability), ["AVAILABLE", "AVAILABLE"]);
});

test("a replay returns the original row and a changed request conflicts", async () => {
  const replayKey = key("replay");
  const first = await add(2, replayKey);
  const replayed = await add(2, replayKey);
  assert.equal(replayed!.id, first!.id);
  await assert.rejects(
    () => add(3, replayKey),
    (error) => isIdempotencyConflictError(error),
  );
});

test("calling and closing stay branch scoped and terminal", async () => {
  const entry = await add(2);
  await assert.rejects(
    () => callBoardGameWaitlistEntry({
      tenantId, locationId: otherLocationId, actorUserId: staffId, entryId: entry!.id,
      idempotencyKey: key("wrong-branch"),
    }),
    /สถานะไม่อนุญาต|ปิดไปแล้ว/,
  );
  const called = await callBoardGameWaitlistEntry({
    tenantId, locationId, actorUserId: staffId, entryId: entry!.id,
    idempotencyKey: key("call"),
  });
  assert.equal(called!.status, "CALLED");
  assert.ok(called!.calledAt);
  const closed = await closeBoardGameWaitlistEntry({
    tenantId, locationId, actorUserId: staffId, entryId: entry!.id,
    idempotencyKey: key("no-show"), status: "NO_SHOW", reason: "FAKE did not arrive",
  });
  assert.equal(closed!.status, "NO_SHOW");
  assert.ok(closed!.closedAt);
  await assert.rejects(
    () => callBoardGameWaitlistEntry({
      tenantId, locationId, actorUserId: staffId, entryId: entry!.id,
      idempotencyKey: key("call-terminal"),
    }),
    /สถานะไม่อนุญาต|ปิดไปแล้ว/,
  );
});

test("reservations lock one table window, reject overlap, and check in to the service-day queue", async () => {
  const reservedFor = futureIso(1);
  const reservation = await reserve(largeTableId, reservedFor, 4);
  assert.equal(reservation!.kind, "RESERVATION");
  assert.equal(reservation!.status, "CONFIRMED");
  assert.equal(reservation!.queueNo, null);
  assert.equal(reservation!.reservedTableId, largeTableId);
  await assert.rejects(
    () => reserve(largeTableId, new Date(Date.parse(reservedFor) + 30 * 60_000).toISOString(), 2),
    /เวลาทับกัน/,
  );
  const otherTable = await reserve(smallTableId, reservedFor, 2);
  assert.equal(otherTable!.status, "CONFIRMED", "คนละโต๊ะจองเวลาเดียวกันได้");
  const movedFor = futureIso(4);
  const moved = await updateBoardGameReservation({
    tenantId, locationId, actorUserId: staffId, entryId: otherTable!.id,
    idempotencyKey: key("reschedule"), tableId: smallTableId, reservedFor: movedFor,
    durationMinutes: 90, partySize: 2, guestName: "FAKE moved", guestPhone: "0811111111",
  });
  assert.equal(moved!.reservedFor, movedFor);
  assert.equal(moved!.reservedDurationMinutes, 90);
  assert.equal(moved!.guestName, "FAKE moved");

  const checkedIn = await checkInBoardGameReservation({
    tenantId, locationId, actorUserId: staffId, entryId: reservation!.id,
    idempotencyKey: key("check-in"),
  });
  assert.equal(checkedIn!.status, "WAITING");
  assert.ok(checkedIn!.queueNo);
  assert.ok(checkedIn!.checkedInAt);
  await closeBoardGameWaitlistEntry({
    tenantId, locationId, actorUserId: staffId, entryId: reservation!.id,
    idempotencyKey: key("cancel-checked-in"), status: "CANCELLED",
    reason: "FAKE free the table for the next contract",
  });
});

test("capacity rejection rolls back, then seating opens and links the real session atomically", async () => {
  const entry = await add(4);
  const sessionCountBefore = Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_board_game_sessions WHERE tenant_id = $1`,
    [tenantId],
  )).rows[0].n);
  await assert.rejects(
    () => seatBoardGameWaitlistEntry({
      tenantId, locationId, deviceId, shiftId, actorUserId: staffId,
      entryId: entry!.id, tableId: smallTableId, idempotencyKey: key("seat-small"),
      billingMode: "OPEN_ENDED", participants: players(4),
    }),
    /รองรับจำนวนผู้เล่นจริงไม่พอ/,
  );
  const afterReject = (await query<{ status: string }>(
    `SELECT status FROM bms_board_game_waitlist WHERE tenant_id = $1 AND id = $2`,
    [tenantId, entry!.id],
  )).rows[0];
  assert.equal(afterReject.status, "WAITING");
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_board_game_sessions WHERE tenant_id = $1`,
    [tenantId],
  )).rows[0].n), sessionCountBefore);

  const seated = await seatBoardGameWaitlistEntry({
    tenantId, locationId, deviceId, shiftId, actorUserId: staffId,
    entryId: entry!.id, tableId: largeTableId, idempotencyKey: key("seat-large"),
    billingMode: "FIXED_DURATION", expectedDurationMinutes: 120,
    alertBeforeMinutes: 15, participants: players(4),
  });
  assert.equal(seated.entry!.status, "SEATED");
  assert.equal(seated.entry!.seatedTableId, largeTableId);
  assert.equal(seated.entry!.seatedSessionId, seated.session.id);
  const linked = (await query<{
    queue_status: string; session_status: string; seating_table_id: string;
  }>(
    `SELECT w.status AS queue_status, s.status AS session_status, st.table_id AS seating_table_id
       FROM bms_board_game_waitlist w
       JOIN bms_board_game_sessions s
         ON s.tenant_id = w.tenant_id AND s.id = w.seated_session_id
       JOIN bms_board_game_seatings st
         ON st.tenant_id = s.tenant_id AND st.id = s.seating_id
      WHERE w.tenant_id = $1 AND w.id = $2`,
    [tenantId, entry!.id],
  )).rows[0];
  assert.deepEqual(linked, {
    queue_status: "SEATED", session_status: "OPEN", seating_table_id: largeTableId,
  });
  const board = await listBoardGameWaitlist(tenantId, locationId);
  assert.equal(board.tables.find((table) => table.id === largeTableId)!.availability, "OCCUPIED");
  assert.ok(board.tables.find((table) => table.id === largeTableId)!.expectedAvailableAt);
});

test("teardown: the throwaway cafe leaves nothing behind", async () => {
  const ids = [tenantId].filter(Boolean);
  if (!ids.length) return;
  for (const table of [
    "bms_board_game_waitlist",
    "bms_board_game_session_participants",
    "bms_board_game_billing_groups",
    "bms_board_game_sessions",
    "bms_board_game_seatings",
    "bms_board_game_tables",
    "bms_board_game_areas",
    "bms_board_game_time_rates",
    "bms_board_game_idempotency_results",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
    "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`,
    [ids],
  )).rows[0].n), 0);
});
