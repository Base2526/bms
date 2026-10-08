// Writes FAKE fixtures. Run only with scripts/run-contract-tests.mjs db board-game-chat-actions.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query } from "../apps/web/lib/db.ts";
import { previewChatBoardGameReservation, requestChatBoardGameReservation } from "../apps/web/lib/bms/boardGameWaitlist.ts";
import { boardGameReservationFingerprint } from "../apps/web/lib/bms/boardGameReservationPolicy.ts";
import { previewBoardGameChatAction, commitBoardGameChatAction } from "../apps/web/lib/bms/boardGameChatActions.ts";
import { boardGameChatActionFingerprint, type BoardGameChatActionDraft } from "../apps/web/lib/bms/boardGameChatActionPolicy.ts";

let tenantId = "", locationId = "", customerId = "", otherCustomerId = "", staffId = "";
let bookingId = "";
const ref = `fake-chat-actions-${randomUUID()}`;
const authority = () => ({ tenantId, customerId, channel: "web", customerRef: ref });
async function quote(draft: BoardGameChatActionDraft, auth = authority()) {
  const preview = await previewBoardGameChatAction(auth, draft);
  return { draft, preview, fingerprint: boardGameChatActionFingerprint(preview, auth.customerId),
    expiresAt: Date.now() + 900_000, requestKey: randomUUID() };
}
async function booking(hours: number, owner = customerId, people = 2) {
  const local = (await query<{ local: string }>(
    `SELECT to_char((now() + make_interval(hours => $1)) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI') AS local`, [hours],
  )).rows[0].local;
  const preview = await previewChatBoardGameReservation({ tenantId, branch: "FAKE chat actions", reservedLocal: local, durationMinutes: 60, partySize: people });
  return { ...preview, tenantId, customerId: owner, requestKey: randomUUID(), expectedFingerprint: boardGameReservationFingerprint(preview, owner) };
}

test("setup isolated FAKE board-game customer identities, staff and one table", async () => {
  await query(`INSERT INTO roles (name) VALUES ('Administrator') ON CONFLICT (name) DO NOTHING`);
  tenantId = (await query<{ id: string }>(`INSERT INTO bms_tenants (name, slug) VALUES ('FAKE chat actions',$1) RETURNING id`, [ref])).rows[0].id;
  locationId = (await query<{ id: string }>(`INSERT INTO bms_locations (tenant_id, code, name, branch_code) VALUES ($1,'MAIN','FAKE chat actions','00000') RETURNING id`, [tenantId])).rows[0].id;
  await query(`INSERT INTO bms_store_profile (tenant_id, business_archetype, timezone) VALUES ($1,'board_game_cafe','Asia/Bangkok')`, [tenantId]);
  await query(`INSERT INTO bms_board_game_public_locations (tenant_id,location_id,booking_enabled,chat_auto_confirm) VALUES ($1,$2,TRUE,TRUE)`, [tenantId, locationId]);
  const areaId = (await query<{ id: string }>(`INSERT INTO bms_board_game_areas (tenant_id,location_id,name) VALUES ($1,$2,'FAKE area') RETURNING id`, [tenantId,locationId])).rows[0].id;
  await query(`INSERT INTO bms_board_game_tables (tenant_id,location_id,area_id,code,name,seats) VALUES ($1,$2,$3,'FAKE-ONE','FAKE table',4)`, [tenantId, locationId, areaId]);
  const customers = await query<{ id: string }>(`INSERT INTO bms_customers (tenant_id,name,phone) VALUES ($1,'FAKE one','0800000000'),($1,'FAKE two','0800000001') RETURNING id`, [tenantId]);
  [customerId, otherCustomerId] = customers.rows.map(r => r.id);
  await query(`INSERT INTO bms_customer_identities (tenant_id,customer_id,channel,external_ref) VALUES ($1,$2,'web',$3),($1,$4,'web',$5)`, [tenantId,customerId,ref,otherCustomerId,`${ref}-other`]);
  staffId = (await query<{ id: string }>(`INSERT INTO users (name,username,email,role,role_id,tenant_id,password_hash,fake_test)
    SELECT 'FAKE chat staff',$2,$2,'Administrator',id,$1,'x',TRUE FROM roles WHERE name='Administrator' RETURNING id`, [tenantId,`${ref}@example.invalid`])).rows[0].id;
  await query(`INSERT INTO bms_conversations (tenant_id,channel,customer_ref,customer_id,assigned_to_user_id) VALUES ($1,'web',$2,$3,$4)`, [tenantId,ref,customerId,staffId]);
});

test("concurrent automatic bookings cannot allocate the same table window", async () => {
  const first = await booking(100);
  const second = { ...first, customerId: otherCustomerId, requestKey: randomUUID(), expectedFingerprint: boardGameReservationFingerprint(first, otherCustomerId) };
  const results = await Promise.allSettled([requestChatBoardGameReservation(first), requestChatBoardGameReservation(second)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason), /ไม่มีโต๊ะ/);
  const winner = results.findIndex(r => r.status === "fulfilled");
  const created = (results[winner] as PromiseFulfilledResult<any>).value;
  assert.equal(created.status, "CONFIRMED");
  const replay = await requestChatBoardGameReservation(winner === 0 ? first : second);
  assert.equal(replay.requestId, created.requestId);
  const rows = await query(`SELECT reserved_table_id, confirmed_at FROM bms_board_game_waitlist WHERE tenant_id=$1`, [tenantId]);
  assert.equal(rows.rowCount, 1);
  assert.ok(rows.rows[0].reserved_table_id);
  assert.ok(rows.rows[0].confirmed_at);
});

test("opt-out keeps staff review, and a changed policy invalidates a quoted auto booking", async () => {
  const old = await booking(110);
  await query(`UPDATE bms_board_game_public_locations SET chat_auto_confirm=FALSE WHERE tenant_id=$1`, [tenantId]);
  await assert.rejects(requestChatBoardGameReservation(old), /ยืนยันใหม่/);
  const input = await booking(110);
  assert.equal(input.autoConfirm, false);
  const created = await requestChatBoardGameReservation(input);
  const row = (await query(`SELECT status,reserved_table_id FROM bms_board_game_waitlist WHERE tenant_id=$1 AND id=$2`, [tenantId,created.requestId])).rows[0];
  assert.deepEqual(row, { status: "REQUESTED", reserved_table_id: null });
  const cancellation = await quote({ action: "CANCEL", reference: created.requestId.slice(0,8) });
  await commitBoardGameChatAction(authority(), cancellation);
  await query(`UPDATE bms_board_game_public_locations SET chat_auto_confirm=TRUE WHERE tenant_id=$1`, [tenantId]);
});

test("customer cancellation and reschedule enforce ownership and rollback on table conflicts", async () => {
  bookingId = (await requestChatBoardGameReservation(await booking(120))).requestId;
  const reference = bookingId.slice(0,8);
  const other = { ...authority(), customerId: otherCustomerId, customerRef: `${ref}-other` };
  await assert.rejects(quote({ action: "CANCEL", reference }, other), /not found/);
  await assert.rejects(quote({ action: "CANCEL", reference }, { ...authority(), customerRef: `${ref}-other` }), /identity/);
  await assert.rejects(quote({ action: "CANCEL", reference }, { ...authority(), tenantId: randomUUID() }));
  const unavailable = await booking(100);
  const bad = await quote({ action: "RESCHEDULE", reference, reservedLocal: unavailable.reservedLocal, durationMinutes: 60, partySize: 2 });
  await assert.rejects(commitBoardGameChatAction(authority(), bad), /unavailable/);
  const original = (await query(`SELECT reserved_for FROM bms_board_game_waitlist WHERE tenant_id=$1 AND id=$2`, [tenantId,bookingId])).rows[0].reserved_for;
  assert.notEqual(new Date(original).toISOString(), unavailable.reservedFor);
  const retained = await booking(130);
  const retainedChange = await quote({ action: "RESCHEDULE", reference, reservedLocal: retained.reservedLocal });
  const retainedResult = await commitBoardGameChatAction(authority(), retainedChange);
  assert.equal(retainedResult.status, "CONFIRMED");
  const retainedRow = (await query(`SELECT reserved_for, party_size, reserved_duration_minutes FROM bms_board_game_waitlist WHERE tenant_id=$1 AND id=$2`, [tenantId,bookingId])).rows[0];
  assert.equal(new Date(retainedRow.reserved_for).toISOString(), retained.reservedFor);
  assert.equal(Number(retainedRow.party_size), 2);
  assert.equal(Number(retainedRow.reserved_duration_minutes), 60);
  const next = await booking(140);
  const change = await quote({ action: "RESCHEDULE", reference, reservedLocal: next.reservedLocal, durationMinutes: 90, partySize: 3 });
  const result = await commitBoardGameChatAction(authority(), change);
  assert.equal(result.status, "CONFIRMED");
  assert.deepEqual(await commitBoardGameChatAction(authority(), change), result);
  const moved = (await query(`SELECT reserved_for, party_size, reserved_duration_minutes FROM bms_board_game_waitlist WHERE tenant_id=$1 AND id=$2`, [tenantId,bookingId])).rows[0];
  assert.equal(new Date(moved.reserved_for).toISOString(), next.reservedFor);
  assert.equal(Number(moved.party_size), 3);
  assert.equal(Number(moved.reserved_duration_minutes), 90);
});

test("expired or stale consent does not cancel; confirmed cancellation is retry-safe", async () => {
  const cancellation = await quote({ action: "CANCEL", reference: bookingId.slice(0,8) });
  await assert.rejects(commitBoardGameChatAction(authority(), { ...cancellation, expiresAt: Date.now()-1 }), /fresh summary/);
  await query(`UPDATE bms_board_game_waitlist SET note='FAKE staff update',updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId,bookingId]);
  await assert.rejects(commitBoardGameChatAction(authority(), cancellation), /changed/);
  const fresh = await quote(cancellation.draft);
  const results = await Promise.all([commitBoardGameChatAction(authority(), fresh), commitBoardGameChatAction(authority(), fresh)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].status, "CANCELLED");
});

test("money, discount, extra-time and staff requests create durable mentions once and no money or clock", async () => {
  for (const action of ["REFUND", "DISCOUNT", "EXTEND_TIME", "STAFF"] as const) {
    const request = await quote({ action, note: "FAKE please review 30 extra minutes or the bill" });
    const result = await commitBoardGameChatAction(authority(), request);
    assert.equal(result.status, "STAFF_REVIEW");
    assert.deepEqual(await commitBoardGameChatAction(authority(), request), result);
  }
  assert.equal((await query(`SELECT id FROM bms_conversation_notes WHERE tenant_id=$1`, [tenantId])).rowCount, 4);
  assert.equal((await query(`SELECT id FROM bms_conversation_note_mentions WHERE tenant_id=$1 AND mentioned_user_id=$2`, [tenantId,staffId])).rowCount, 4);
  for (const table of ["bms_payments", "bms_orders", "bms_board_game_sessions"]) {
    assert.equal((await query(`SELECT id FROM ${table} WHERE tenant_id=$1`, [tenantId])).rowCount, 0);
  }
  const audit = (await query(`SELECT meta FROM bms_audit_log WHERE tenant_id=$1 AND action='board_game.chat_action'`, [tenantId])).rows;
  assert.doesNotMatch(JSON.stringify(audit), /extra minutes|080000|customerRef|fingerprint/);
});

test("teardown FAKE fixtures", async () => {
  if (!tenantId) return;
  for (const table of ["bms_conversation_note_mentions", "bms_conversation_notes", "bms_conversations", "bms_board_game_waitlist",
    "bms_customers", "bms_board_game_tables", "bms_board_game_areas", "bms_board_game_idempotency_results", "bms_board_game_public_locations",
    "bms_store_profile", "bms_locations", "bms_audit_log", "users"]) {
    await query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
  }
  await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]);
});
