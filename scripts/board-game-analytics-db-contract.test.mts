/**
 * Board-game occupancy ledger against a real local PostgreSQL database.
 * Writes only a throwaway tenant and is intentionally excluded from the pure gate.
 * Run through: node scripts/run-contract-tests.mjs db board-game-analytics-db-contract
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { readBoardGameLiveOperations, readBoardGamePassBalances, readBoardGameOwnerLibrary } from "../apps/web/lib/bms/boardGameOwnerReads.ts";
import { getBoardGameAnalytics } from "../apps/web/lib/bms/boardGameAnalytics.ts";
import {
  closeSessionTableOccupancyInTx,
  closeTableOccupancyInTx,
  moveTableOccupancyInTx,
  moveSessionsTableOccupancyInTx,
  openSessionTableOccupancyInTx,
  openTableOccupancyInTx,
} from "../apps/web/lib/bms/boardGameOccupancy.ts";

test("10.89 preserves move history, tenant scope, uniqueness and effective hours in PostgreSQL", async () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId = "";
  let actorId = "";
  let locationId = "";
  let areaId = "";
  let firstTableId = "";
  let secondTableId = "";
  let seatingId = "";
  let sessionId = "";
  try {
    tenantId = (await query<{ id: string }>(
      `INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`,
      [`FAKE analytics ${suffix}`, `fake-bg-analytics-${suffix}`],
    )).rows[0].id;
    locationId = (await query<{ id: string }>(
      `INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id`,
      [tenantId, `FAKE analytics branch ${suffix}`],
    )).rows[0].id;
    await query(`INSERT INTO bms_store_profile(tenant_id,business_archetype,timezone) VALUES($1,'board_game_cafe','Asia/Bangkok')`, [tenantId]);
    actorId = (await query<{ id: string }>(
      `INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
       SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r WHERE r.name='Administrator' LIMIT 1 RETURNING id`,
      [tenantId, `FAKE analytics actor ${suffix}`, `fake-bg-analytics-${suffix}@example.invalid`],
    )).rows[0].id;
    areaId = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_areas(tenant_id,location_id,name) VALUES($1,$2,$3) RETURNING id`,
      [tenantId, locationId, `FAKE analytics area ${suffix}`],
    )).rows[0].id;
    const tables = (await query<{ id: string; code: string }>(
      `INSERT INTO bms_board_game_tables(tenant_id,location_id,area_id,code,name,seats,sort_order)
       VALUES($1,$2,$3,'FAKE-A',$4,4,1),($1,$2,$3,'FAKE-B',$5,4,2) RETURNING id,code`,
      [tenantId, locationId, areaId, `FAKE A ${suffix}`, `FAKE B ${suffix}`],
    )).rows;
    firstTableId = tables.find((row) => row.code === "FAKE-A")!.id;
    secondTableId = tables.find((row) => row.code === "FAKE-B")!.id;
    seatingId = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_seatings(tenant_id,location_id,table_id,opened_at)
       VALUES($1,$2,$3,'2026-10-01T03:00:00Z') RETURNING id`,
      [tenantId, locationId, firstTableId],
    )).rows[0].id;
    sessionId = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_sessions
         (tenant_id,location_id,table_id,seating_id,billing_mode,guest_count,started_at,open_idempotency_key,open_request_hash)
       VALUES($1,$2,$3,$4,'OPEN_ENDED',2,'2026-10-01T03:00:00Z',$5,$6) RETURNING id`,
      [tenantId, locationId, firstTableId, seatingId, `analytics-${suffix}`, `hash-${suffix}`],
    )).rows[0].id;

    const client = await getClient();
    try {
      await beginTenantTx(client, tenantId, { editorId: actorId });
      await openTableOccupancyInTx(client, tenantId, { locationId, tableId: firstTableId, seatingId, startedAt: new Date("2026-10-01T03:00:00Z") });
      await openSessionTableOccupancyInTx(client, tenantId, { locationId, tableId: firstTableId, sessionId, startedAt: new Date("2026-10-01T03:00:00Z") });
      await client.query(`UPDATE bms_board_game_seatings SET table_id=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, seatingId, secondTableId]);
      await moveTableOccupancyInTx(client, tenantId, { locationId, tableId: secondTableId, seatingId, movedAt: new Date("2026-10-01T04:00:00Z") });
      await moveSessionsTableOccupancyInTx(client, tenantId, { locationId, tableId: secondTableId, sessionIds: [sessionId], movedAt: new Date("2026-10-01T04:00:00Z"), reason: "MOVED" });
      await closeTableOccupancyInTx(client, tenantId, seatingId, new Date("2026-10-01T05:30:00Z"), "CLOSED");
      await closeSessionTableOccupancyInTx(client, tenantId, sessionId, new Date("2026-10-01T05:30:00Z"), "CLOSED");
      await client.query(
        `INSERT INTO bms_board_game_branch_hours(tenant_id,location_id,weekday,opens_at,closes_at,closed,effective_from,created_by)
         SELECT $1,$2,day,'10:00'::time,'22:00'::time,FALSE,'2026-01-01',$3 FROM generate_series(0,6) day`,
        [tenantId, locationId, actorId],
      );
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }

    const intervals = await query<{ table_id: string; started_at: Date; ended_at: Date; end_reason: string }>(
      `SELECT table_id,started_at,ended_at,end_reason FROM bms_board_game_table_occupancy
        WHERE tenant_id=$1 AND seating_id=$2 ORDER BY started_at`, [tenantId, seatingId],
    );
    assert.equal(intervals.rowCount, 2);
    assert.deepEqual(intervals.rows.map((row) => row.table_id), [firstTableId, secondTableId]);
    assert.deepEqual(intervals.rows.map((row) => row.end_reason), ["MOVED", "CLOSED"]);
    assert.equal(intervals.rows[0].ended_at.toISOString(), "2026-10-01T04:00:00.000Z");
    assert.equal(intervals.rows[1].ended_at.toISOString(), "2026-10-01T05:30:00.000Z");
    const sessionIntervals = await query<{ table_id: string; end_reason: string }>(
      `SELECT table_id,end_reason FROM bms_board_game_session_table_occupancy
        WHERE tenant_id=$1 AND session_id=$2 ORDER BY started_at`, [tenantId, sessionId],
    );
    assert.equal(sessionIntervals.rowCount, 2);
    assert.deepEqual(sessionIntervals.rows.map((row) => row.table_id), [firstTableId, secondTableId]);
    assert.deepEqual(sessionIntervals.rows.map((row) => row.end_reason), ["MOVED", "CLOSED"]);
    assert.equal((await query(`SELECT 1 FROM bms_board_game_branch_hours WHERE tenant_id=$1`, [tenantId])).rowCount, 7);

    // Execute new owner-read SQL against the same isolated fixture (including empty-library paths).
    // These assertions are not part of the DB-free gate.
    const floor = await readBoardGameLiveOperations(tenantId, actorId, { locationId, limit: 1 });
    assert.equal(floor.totals.tables, 2);
    assert.equal(floor.totals.occupied, 1);
    assert.equal(floor.tables.nextOffset, 1);
    const passes = await readBoardGamePassBalances(tenantId, actorId, { locationId });
    assert.equal(passes.outstanding.outstandingMinutes, 0);
    assert.equal(passes.outstanding.expiringMinutesIn30Days, 0);
    assert.equal(passes.outstanding.expiringPassesIn30Days, 0);
    assert.deepEqual(passes.expiring.rows, []);
    for (const view of ["COPIES", "ATTENTION", "UNPLAYED", "USAGE"] as const) {
      const library = await readBoardGameOwnerLibrary(tenantId, actorId, { locationId, view,
        ...(view === "USAGE" ? { from: "2026-10-01", to: "2026-10-23" } : {}) });
      assert.deepEqual(library.rows, []);
      assert.equal(library.nextOffset, null);
    }
    await assert.rejects(readBoardGameOwnerLibrary(tenantId, actorId, { locationId: randomUUID(), view: "COPIES" }), /BOARD_GAME_OWNER_FORBIDDEN/);
    const report = await getBoardGameAnalytics(tenantId, actorId, { locationId, from: "2026-10-01", to: "2026-10-23" }, undefined, { includeCosts: false });
    assert.equal(report.totals.waitlist.avgWaitMinutes, null, "an empty queue is unknown wait, not zero");
    assert.equal(report.totals.guests, 0, "this fixture has no participant evidence");
    assert.ok(report.issues.some(issue => issue.code === "CURRENT_CAPACITY_BASIS"));

    // Run as the application's non-BYPASSRLS role, with a different tenant GUC.
    // Explicitly request the other tenant: PostgreSQL must still deny visibility.
    const isolated = await getClient();
    try {
      await beginTenantTx(isolated, randomUUID());
      await isolated.query("SET LOCAL ROLE bms_app");
      for (const table of ["bms_board_game_table_occupancy", "bms_board_game_session_table_occupancy", "bms_board_game_branch_hours"]) {
        assert.equal((await isolated.query(`SELECT id FROM ${table} WHERE tenant_id=$1`, [tenantId])).rowCount, 0);
      }
      await isolated.query("SAVEPOINT denied_write");
      await assert.rejects(isolated.query(
        `INSERT INTO bms_board_game_branch_hours(tenant_id,location_id,weekday,closed,effective_from)
         VALUES($1,$2,0,TRUE,'2026-10-02')`, [tenantId, locationId],
      ), (error: any) => error?.code === "42501");
      await isolated.query("ROLLBACK TO SAVEPOINT denied_write");
    } finally { await isolated.query("ROLLBACK"); isolated.release(); }

    await assert.rejects(
      query(
        `INSERT INTO bms_board_game_branch_hours(tenant_id,location_id,weekday,opens_at,closes_at,closed,effective_from)
         VALUES($1,$2,0,'11:00','23:00',FALSE,'2026-01-01')`,
        [tenantId, locationId],
      ),
      (error: any) => error?.code === "23505",
    );
  } finally {
    if (tenantId) {
      await query(`DELETE FROM bms_board_game_table_occupancy WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_session_table_occupancy WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_branch_hours WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_sessions WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_seatings WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_tables WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_board_game_areas WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_store_profile WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM users WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_locations WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]).catch(() => undefined);
    }
  }
});
