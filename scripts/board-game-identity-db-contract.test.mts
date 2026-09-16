/**
 * บัตรที่ร้านถือไว้ค้ำกล่องเกม (`9.93`) กับ Postgres จริง
 *
 * สิ่งที่ชุดนี้พิสูจน์ ไม่ใช่ว่า CRUD ทำงาน แต่คือสามอย่างที่พังแล้วเงียบ:
 *
 *  - เลขที่เก็บลงฐานเป็นซองที่ถอดได้ด้วยคีย์เท่านั้น ไม่ใช่ข้อความที่ใครเปิดตารางก็อ่านได้
 *  - **คืนบัตร = ล้างข้อมูลส่วนบุคคลในทรานแซกชันเดียวกัน** — แถวที่เหลือยังตอบได้ว่าคืนไปแล้ว
 *    และใครเป็นคนยื่นให้ ซึ่งเป็นคำถามที่ต้องตอบได้เมื่อลูกค้ากลับมาทวง
 *  - ลูกค้าจ่ายเงินแล้วเดินออกไปโดยที่บัตรยังอยู่ในลิ้นชักไม่ได้ · ด่านอยู่ที่ทางออกทุกทางของโต๊ะ
 *    และต้อง **ไม่** ไปบล็อกกลุ่มที่จ่ายก่อนแล้วกลับบ้านขณะที่คนอื่นยังเล่นอยู่
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production** · ต้องสร้าง
 * tenant เองเพราะชุดนี้ตั้ง `business_archetype = 'board_game_cafe'` ซึ่งเปลี่ยนพฤติกรรมของ
 * ทุกบิลในร้านนั้น (โน้ตใน CLAUDE.local.md: การยืมร้านจริงมาสลับ archetype ทำร้านค้างจนเทสแดง)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { isIdempotencyConflictError } from "../apps/web/lib/bms/idempotencyErrors.ts";
import {
  cancelBoardGameSession,
  checkoutBoardGameCopy,
  closeBoardGameBillingGroupForBilling,
  closeBoardGameSessionForBilling,
  createBoardGameCopy,
  createBoardGameTitle,
  getBoardGameSession,
  openBoardGameSession,
  returnBoardGameCopy,
} from "../apps/web/lib/bms/boardGameCafe.ts";
import {
  listBoardGameIdentityHolds,
  releaseBoardGameIdentityHold,
  revealBoardGameIdentityNumber,
  takeBoardGameIdentityHold,
} from "../apps/web/lib/bms/boardGameIdentity.ts";

const TAG = "bg-identity-test";

let tenantId = "";
let locationId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
let rateId = "";
let memberId = "";
let copyId = "";
const tables: Record<string, string> = {};

let seq = 0;
const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++seq}`;

const rowOf = async (holdId: string) =>
  (await query<{
    status: string; holder_name: string | null; document_number_encrypted: string | null;
    document_number_tail: string | null; purged_at: Date | null; returned_by: string | null;
  }>(
    `SELECT status, holder_name, document_number_encrypted, document_number_tail,
            purged_at, returned_by
       FROM bms_board_game_identity_holds WHERE tenant_id = $1 AND id = $2`,
    [tenantId, holdId]
  )).rows[0];

async function openTable(tableId: string, minutesAgo: number, groups = [1]) {
  return openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open"),
      locationId,
      tableId,
      billingMode: "OPEN_ENDED",
      startedAt: new Date(Date.now() - minutesAgo * 60_000),
      posDeviceId: deviceId,
      posShiftId: shiftId,
      participants: groups.map((groupNo) => ({
        rateId, displayName: `FAKE guest ${groupNo}`, participantType: "GENERAL", billingGroupNo: groupNo,
      })),
    } as never,
    staffId
  );
}

const take = (sessionId: string, overrides: Record<string, unknown> = {}) =>
  takeBoardGameIdentityHold(
    tenantId,
    {
      sessionId,
      idempotencyKey: key("hold"),
      documentKind: "NATIONAL_ID",
      holderName: "FAKE Somchai",
      documentNumber: "1-2345-67890-12-3",
      ...overrides,
    } as never,
    staffId
  );

test("setup: a throwaway board-game cafe with one playable copy", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${Date.now()}`]
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'board_game_cafe')`,
    [tenantId]
  );
  staffId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} staff`, `fake-${TAG}-staff-${Date.now()}@example.invalid`]
  )).rows[0].id;
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-1',$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} device`]
  )).rows[0].id;
  shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`, [tenantId, locationId, deviceId, staffId]
  )).rows[0].id;
  areaId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_areas (tenant_id, location_id, name)
     VALUES ($1,$2,$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} zone`]
  )).rows[0].id;
  // โต๊ะละเทส — เปิดโต๊ะซ้ำใบเดิมจะแดงด้วย "โต๊ะนี้มีลูกค้าอยู่แล้ว" ซึ่งไม่ใช่กฎที่กำลังตรึง
  for (const code of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]) {
    tables[code] = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
       VALUES ($1,$2,$3,$4,$5,6) RETURNING id`,
      [tenantId, locationId, areaId, `FAKE-${code}`, `FAKE ${TAG} ${code}`]
    )).rows[0].id;
  }
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes, rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_GENERAL',$2,'GENERAL',60,60,60,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`]
  )).rows[0].id;
  memberId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, member_no, tags)
     VALUES ($1,$2,$3,ARRAY['fake']) RETURNING id`,
    [tenantId, `FAKE ${TAG} member`, `FAKE-ID-${Date.now()}`]
  )).rows[0].id;
  const title = await createBoardGameTitle(tenantId, { title: `FAKE ${TAG} game` }, staffId);
  const copy = await createBoardGameCopy(
    tenantId, { titleId: title.id, locationId, copyCode: `FAKE-COPY-${Date.now()}` }, staffId
  );
  copyId = copy.id;
});

test("the number never reaches the table as text, and the tail is what staff match on", async () => {
  const session = await openTable(tables.T1, 20);
  const hold = await take(session.id, { customerId: memberId });

  assert.equal(hold.holderName, "FAKE Somchai");
  assert.equal(hold.documentNumberTail, "0123", "สี่ตัวท้ายของเลขที่ normalize แล้ว");
  assert.equal(hold.hasDocumentNumber, true);
  assert.equal((hold as Record<string, unknown>).documentNumber, undefined,
    "รูปที่ผู้เรียกได้ต้องไม่มีเลขเต็มเลย");

  const stored = await rowOf(hold.id);
  assert.ok(stored.document_number_encrypted?.startsWith("enc:"),
    "เลขต้องถูกเข้ารหัสก่อนแตะฐาน ไม่ใช่ข้อความที่เปิดตารางแล้วอ่านได้");
  assert.ok(!stored.document_number_encrypted!.includes("1234567890123"));

  // เส้นอ่านของโต๊ะ (จอเครื่องขายใช้เส้นนี้) ต้องไม่มีเลขเต็มเช่นกัน
  const detail = await getBoardGameSession(tenantId, session.id);
  const asJson = JSON.stringify(detail.identityHolds);
  assert.ok(!asJson.includes("1234567890123"), "เลขเต็มหลุดออกมาที่เส้นอ่านของโต๊ะ");
  assert.match(asJson, /"documentNumberTail":"0123"/);

  // ...และทางเดียวที่เลขกลับออกมาคือ reveal ซึ่งบันทึกไว้ว่ามีคนอ่าน
  const revealed = await revealBoardGameIdentityNumber(tenantId, hold.id, staffId, "FAKE ลูกค้าไม่คืนเกม");
  assert.equal(revealed.documentNumber, "1234567890123", "ถอดกลับได้เลขเดิมที่ normalize แล้ว");
  const audits = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'board_game.identity_hold_reveal' AND target = $2`,
    [tenantId, hold.id]
  );
  assert.equal(Number(audits.rows[0].n), 1, "ทุกครั้งที่อ่านเลขต้องเหลือร่องรอย");
});

test("handing the card back erases it, and leaves proof that it was handed back", async () => {
  const session = await openTable(tables.T2, 20);
  const hold = await take(session.id);

  const released = await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
  assert.equal(released.status, "RETURNED");
  assert.equal(released.holderName, null);
  assert.equal(released.documentNumberTail, null);
  assert.equal(released.hasDocumentNumber, false);
  assert.ok(released.returnedAt, "ต้องรู้ว่าคืนเมื่อไร");

  const stored = await rowOf(hold.id);
  assert.equal(stored.holder_name, null);
  assert.equal(stored.document_number_encrypted, null);
  assert.equal(stored.document_number_tail, null);
  assert.ok(stored.purged_at, "คืนบัตรแล้วต้องถูกประทับว่า purge ไปแล้ว");
  // tombstone: แถวยังอยู่และยังตอบได้ว่าใครยื่นให้ — ลบทั้งแถวจะตอบคำถามนี้ไม่ได้
  assert.equal(stored.returned_by, staffId);
  assert.equal(stored.status, "RETURNED");

  // อ่านเลขของบัตรที่คืนไปแล้ว = ไม่มีอะไรให้อ่าน (ไม่ใช่ error)
  const revealed = await revealBoardGameIdentityNumber(tenantId, hold.id, staffId);
  assert.equal(revealed.documentNumber, null);

  // คืนซ้ำไม่ทำอะไร — บัตรอยู่ในมือเจ้าของแล้ว
  const again = await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
  assert.equal(again.replayed, true);
  assert.equal((await rowOf(hold.id)).returned_by, staffId);
});

test("a table cannot end while a card is still in the drawer", async () => {
  const session = await openTable(tables.T3, 90);
  const hold = await take(session.id);

  await assert.rejects(
    () => closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId),
    /คืนบัตร/,
    "จ่ายเงินแล้วเดินออกไปโดยที่บัตรยังอยู่ในลิ้นชักไม่ได้",
  );
  await assert.rejects(
    () => cancelBoardGameSession(
      tenantId, session.id, { idempotencyKey: key("cancel"), reason: "FAKE" }, staffId
    ),
    /คืนบัตร/,
    "ยกเลิกโต๊ะต้องไม่กลายเป็นทางเลี่ยงด่านตอนปิดบิล",
  );

  await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close-ok") }, staffId
  );
  assert.ok(closed.amountDue > 0, "คืนบัตรแล้วต้องปิดบิลได้ตามปกติ");
});

test("the card blocks only the last group, never the one that paid and went home", async () => {
  // สองกลุ่มบนโต๊ะเดียว · บัตรเป็นของ "การมาเล่นครั้งนี้" ไม่ใช่ของกลุ่มใดกลุ่มหนึ่ง แต่ถ้าด่าน
  // ไปอยู่ทุกกลุ่ม คนที่จ่ายก่อนแล้วกลับบ้านจะถูกบล็อกด้วยบัตรของคนที่ยังนั่งอยู่
  const session = await openTable(tables.T4, 90, [1, 2]);
  const hold = await take(session.id);
  const detail = await getBoardGameSession(tenantId, session.id);
  assert.equal(detail.billingGroups.length, 2);

  const first = await closeBoardGameBillingGroupForBilling(
    tenantId, detail.billingGroups[0].id, { idempotencyKey: key("group-1") }, staffId
  );
  assert.ok(first.amountDue > 0, "กลุ่มแรกต้องปิดได้ทั้งที่ยังถือบัตรอยู่");

  await assert.rejects(
    () => closeBoardGameBillingGroupForBilling(
      tenantId, detail.billingGroups[1].id, { idempotencyKey: key("group-2") }, staffId
    ),
    /คืนบัตร/,
    "กลุ่มสุดท้ายคือจังหวะที่โต๊ะจบ — ตรงนั้นต้องคืนบัตรก่อน",
  );

  await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
  const last = await closeBoardGameBillingGroupForBilling(
    tenantId, detail.billingGroups[1].id, { idempotencyKey: key("group-2-ok") }, staffId
  );
  assert.ok(last.amountDue > 0);
});

test("a card recorded against a game box follows the same rules as the box", async () => {
  const session = await openTable(tables.T5, 30);
  const loan = await checkoutBoardGameCopy(
    tenantId, { sessionId: session.id, copyId, idempotencyKey: key("lend") }, staffId
  );
  const hold = await take(session.id, { loanId: loan.id });
  assert.equal(hold.loanId, loan.id);

  // ใบยืมของโต๊ะอื่นผูกไม่ได้ — บัตรที่ชี้ไปผิดโต๊ะตอบคำถาม "ค้ำอะไรอยู่" ผิด
  const other = await openTable(tables.T6, 5);
  await assert.rejects(
    () => take(other.id, { loanId: loan.id }),
    /ไม่ใช่ของโต๊ะนี้/,
  );

  // รับเกมคืนแล้วบัตรยังอยู่ในลิ้นชัก — ระบบบันทึกได้แค่ว่าใครยื่นให้ ไม่ได้ยื่นแทนคน
  await returnBoardGameCopy(
    tenantId, { loanId: loan.id, idempotencyKey: key("give-back") }, staffId
  );
  await assert.rejects(
    () => take(session.id, { loanId: loan.id, holderName: "FAKE returned loan" }),
    /กำลังยืมอยู่/,
    "บัตรใหม่ห้ามผูกกับประวัติกล่องที่คืนแล้ว",
  );
  const stillHeld = await listBoardGameIdentityHolds(tenantId, { sessionId: session.id, openOnly: true });
  assert.equal(stillHeld.length, 1, "รับเกมคืนไม่ได้แปลว่าบัตรถูกคืนไปแล้ว");
  await assert.rejects(
    () => closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("c") }, staffId),
    /คืนบัตร/,
    "นี่คือความล้มเหลวจริงที่ด่านนี้มีไว้กัน: เกมกลับมาแล้วแต่บัตรยังไม่ได้คืน",
  );
  await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("c-ok") }, staffId);
});

test("retrying the same request gets the same card, a different one is a conflict", async () => {
  const session = await openTable(tables.T7, 10);
  const sameKey = key("replay");
  const first = await takeBoardGameIdentityHold(
    tenantId,
    { sessionId: session.id, idempotencyKey: sameKey, documentKind: "STUDENT_ID", holderName: "FAKE A" } as never,
    staffId
  );
  const replay = await takeBoardGameIdentityHold(
    tenantId,
    { sessionId: session.id, idempotencyKey: sameKey, documentKind: "STUDENT_ID", holderName: "FAKE A" } as never,
    staffId
  );
  assert.equal(replay.id, first.id, "ยิงซ้ำต้องได้ใบเดิม ไม่ใช่บัตรใบที่สองของคนเดียวกัน");
  assert.equal(replay.replayed, true);

  await assert.rejects(
    () => takeBoardGameIdentityHold(
      tenantId,
      { sessionId: session.id, idempotencyKey: sameKey, documentKind: "PASSPORT", holderName: "FAKE B" } as never,
      staffId
    ),
    (error: unknown) => isIdempotencyConflictError(error),
    "คีย์เดิมกับข้อมูลคนละชุด = ดึงของจริงมาดู ไม่ใช่เขียนทับ",
  );
  await releaseBoardGameIdentityHold(tenantId, first.id, {}, staffId);
});

test("a card can only be taken against a table that is still open in this shop", async () => {
  const session = await openTable(tables.T8, 10);
  await assert.rejects(() => take(session.id, { holderName: "" }), /ชื่อบนบัตร/);
  await assert.rejects(() => take(session.id, { documentKind: "LIBRARY_CARD" }), /ชนิดเอกสาร/);
  await assert.rejects(
    () => take("00000000-0000-4000-8000-000000000000"),
    /ไม่พบโต๊ะ/,
    "รับบัตรไว้กับโต๊ะที่ไม่มีอยู่ = บัตรที่ไม่มีใครถูกบังคับให้คืน",
  );

  // โต๊ะที่จ่ายเงินไปแล้วรับบัตรใหม่ไม่ได้ — ด่านตอนปิดบิลจะไม่มีวันเห็นมัน
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  await assert.rejects(
    () => take(session.id),
    /ไม่พบโต๊ะที่ยังเปิดอยู่/,
    "ทันทีที่โต๊ะเป็น CLOSING ต้องรับบัตรเพิ่มไม่ได้ ไม่ต้องรอให้จ่ายเป็น PAID",
  );
  await query(
    `UPDATE bms_board_game_sessions SET status = 'PAID' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, session.id]
  );
  await assert.rejects(() => take(session.id), /ไม่พบโต๊ะที่ยังเปิดอยู่/);
});

test("teardown: the throwaway shop leaves nothing behind", async () => {
  const ids = (await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  )).rows.map((row) => row.id);
  if (!ids.length) return;
  await query(
    `UPDATE bms_orders SET board_game_session_id = NULL, board_game_billing_group_id = NULL
      WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_board_game_identity_holds",
    "bms_board_game_session_games",
    "bms_board_game_session_participants",
    "bms_board_game_group_items",
    "bms_board_game_billing_groups",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_orders",
    "bms_board_game_sessions",
    "bms_board_game_seatings",
    "bms_board_game_copies",
    "bms_board_game_titles",
    "bms_board_game_tables",
    "bms_board_game_areas",
    "bms_board_game_time_rates",
    "bms_board_game_idempotency_results",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_customers",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
    "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    0,
    "ร้านทดสอบต้องไม่เหลือค้างในฐาน"
  );
});
