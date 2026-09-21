/**
 * Board-game billing groups (`9.89`) against a real Postgres.
 *
 * Before this migration the *table session* owned the money: one settlement key, one frozen
 * charge snapshot, one `current_order_id`, and `9.82`'s unique index claimed that order per
 * session.  `billing_group_no` existed on a participant and reached the charge lines, but every
 * group settled inside the same order — so "this group pays and leaves" had nowhere to be
 * recorded, and the second group of a split table could not be settled at all.
 *
 * What this suite pins down is the seam, not the happy path:
 *
 *  - closing a split table must produce **one bill per group**, each with only its own people;
 *  - paying one bill must not free the table while another group is still playing, because the
 *    partial unique index on an open session is what decides whether the table can be reopened;
 *  - a closed group must refuse new players, or their time can never be charged — the group's
 *    charge lines were frozen at close;
 *  - the money columns left on the session are history: nothing may write them any more, or the
 *    two rows start disagreeing about what the table owes.
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production** · ต้องสร้าง
 * tenant เองเพราะชุดนี้ตั้ง `business_archetype = 'board_game_cafe'` ซึ่งเปลี่ยนพฤติกรรมของ
 * ทุกบิลในร้านนั้น (โน้ตใน CLAUDE.local.md: การยืมร้านจริงมาสลับ archetype ทำร้านค้างจนเทสแดง)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  addBoardGameGroupItem,
  addBoardGameParticipant,
  cancelBoardGameSession,
  closeBoardGameBillingGroupForBilling,
  closeBoardGameSessionForBilling,
  getBoardGameCheckoutForPos,
  getBoardGameSession,
  leaveBoardGameParticipant,
  listBoardGameFloor,
  mergeBoardGameBillingGroups,
  detachBoardGameBillingGroupToTable,
  openBoardGameSession,
  removeBoardGameGroupItem,
} from "../apps/web/lib/bms/boardGameCafe.ts";
import { recordPosSale } from "../apps/web/lib/bms/pos.ts";

const TAG = "bg-group-test";
const SIZE = "BASE";
const SNACK = `FAKE-${TAG}-SNACK`;

let tenantId = "";
let locationId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
let tableA = "";
let tableB = "";
let tableC = "";
let rateId = "";

let seq = 0;
const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++seq}`;

const sessionRow = async (id: string) =>
  (await query<{ status: string; ended_at: Date | null; guest_count: number; amount_due: string }>(
    `SELECT status, ended_at, guest_count, amount_due::text
       FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )).rows[0];

const money = (value: number) => Math.round(value * 100) / 100;

const groupRows = async (sessionId: string) =>
  (await query<{
    id: string; group_no: number; status: string; amount_due: string; tab_amount: string;
    current_order_id: string | null; settlement_idempotency_key: string | null;
  }>(
    `SELECT id, group_no, status, amount_due::text, tab_amount::text, current_order_id,
            settlement_idempotency_key
       FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY group_no`,
    [tenantId, sessionId]
  )).rows;

async function openSplitTable(tableId: string, people = 4) {
  return openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open"),
      locationId,
      tableId,
      billingMode: "OPEN_ENDED",
      // เวลาเริ่มถอยไปหนึ่งชั่วโมง เพื่อให้มีนาทีที่คิดเงินได้จริงโดยไม่ต้องรอในเทส
      startedAt: new Date(Date.now() - 3600_000),
      posDeviceId: deviceId,
      posShiftId: shiftId,
      participants: Array.from({ length: people }, (_, index) => ({
        rateId,
        displayName: `FAKE player ${index + 1}`,
        // คนคู่อยู่กลุ่ม 1 คนคี่อยู่กลุ่ม 2 — โต๊ะเดียวที่จ่ายแยกกันสองบิล
        billingGroupNo: index % 2 === 0 ? 1 : 2,
      })),
    },
    staffId
  );
}

async function payGroup(billingGroupId: string, amount: number) {
  return recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: staffId,
    idempotencyKey: key("sale"),
    lines: [],
    boardGameBillingGroupId: billingGroupId,
    payments: [{ method: "CASH", amount }],
  });
}

test("setup: a throwaway board-game cafe with a register, an open shift and one time rate", async () => {
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
  tableA = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
     VALUES ($1,$2,$3,'FAKE-T1',$4,6) RETURNING id`, [tenantId, locationId, areaId, `FAKE ${TAG} table 1`]
  )).rows[0].id;
  tableB = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
     VALUES ($1,$2,$3,'FAKE-T2',$4,4) RETURNING id`, [tenantId, locationId, areaId, `FAKE ${TAG} table 2`]
  )).rows[0].id;
  tableC = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
     VALUES ($1,$2,$3,'FAKE-T3',$4,2) RETURNING id`, [tenantId, locationId, areaId, `FAKE ${TAG} table 3`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$2,25,TRUE,'V')`, [tenantId, SNACK]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)`, [tenantId, locationId, SNACK, SIZE]
  );
  const surfaces = (await query<{ reg: string | null }>(
    `SELECT to_regclass('bms_product_sales_surfaces')::text AS reg`)).rows[0]?.reg;
  if (surfaces) {
    for (const surface of ["RETAIL_POS", "ONLINE_ORDER", "PUBLIC_STOREFRONT", "CUSTOMER_AI"]) {
      await query(
        `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, SNACK, surface]
      );
    }
  }
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes, rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_GENERAL',$2,'GENERAL',60,60,30,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`]
  )).rows[0].id;
});

test("opening a table creates one billing group per group number the staff typed", async () => {
  const session = await openSplitTable(tableA, 4);
  const groups = await groupRows(session.id);
  assert.equal(groups.length, 2, "โต๊ะที่แยกสองกลุ่มต้องได้กลุ่มบิลสองใบ");
  assert.deepEqual(groups.map((group) => group.group_no), [1, 2]);
  assert.ok(groups.every((group) => group.status === "OPEN"));

  const detail = await getBoardGameSession(tenantId, session.id);
  assert.equal(detail.billingGroups.length, 2);
  // ผู้เล่นทุกคนต้องผูกกับกลุ่ม ไม่ใช่ลอยอยู่กับ session
  assert.ok(detail.participants.every((person) => Boolean(person.billingGroupId)));
  const byGroup = new Map<number, number>();
  for (const person of detail.participants) {
    byGroup.set(person.billingGroupNo, (byGroup.get(person.billingGroupNo) ?? 0) + 1);
  }
  assert.deepEqual([...byGroup.entries()].sort(), [[1, 2], [2, 2]]);
  await cancelBoardGameSession(tenantId, session.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("a table that is not split still produces exactly one bill", async () => {
  const session = await openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open"),
      locationId,
      tableId: tableA,
      startedAt: new Date(Date.now() - 3600_000),
      posDeviceId: deviceId,
      posShiftId: shiftId,
      participants: [
        { rateId, displayName: "FAKE solo 1" },
        { rateId, displayName: "FAKE solo 2" },
      ],
    },
    staffId
  );
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closed.groups.length, 1, "โต๊ะกลุ่มเดียวต้องได้บิลใบเดียวเหมือนก่อน 9.89");
  assert.equal(closed.groups[0].groupNo, 1);
  assert.equal(closed.groups[0].chargeSnapshot.length, 2);
  assert.equal(closed.amountDue, closed.groups[0].amountDue);

  const group = (await groupRows(session.id))[0];
  const paid = await payGroup(group.id, Number(group.amount_due));
  assert.equal(paid.status, "SOLD", `เก็บเงินไม่ผ่าน: ${JSON.stringify(paid)}`);
  assert.equal((await sessionRow(session.id)).status, "PAID");
});

test("closing a split table hands the register one bill per group, each charging only its own people", async () => {
  const session = await openSplitTable(tableA, 4);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closed.groups.length, 2);
  for (const group of closed.groups) {
    assert.equal(group.chargeSnapshot.length, 2, "บรรทัดค่าเล่นของกลุ่มต้องมีแต่คนของกลุ่มนั้น");
    assert.ok(group.chargeSnapshot.every((line) => line.billingGroupNo === group.groupNo));
    assert.ok(group.amountDue > 0);
  }
  // ยอดรวมของโต๊ะ = ผลรวมของบิลทุกใบ ไม่ใช่เลขที่เก็บแยกไว้อีกที่
  assert.equal(
    closed.amountDue,
    Math.round(closed.groups.reduce((sum, group) => sum + group.amountDue, 0) * 100) / 100
  );
  // แต่ละกลุ่มถือคีย์กันรายการซ้ำของตัวเอง — ใช้คีย์เดียวกันสองใบจะชน unique index ของร้าน
  const keys = (await groupRows(session.id)).map((group) => group.settlement_idempotency_key);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.every(Boolean));
});

test("paying one bill leaves the table occupied until the other group has paid too", async () => {
  const open = (await query<{ id: string }>(
    `SELECT id FROM bms_board_game_sessions
      WHERE tenant_id = $1 AND table_id = $2 AND status IN ('OPEN','CLOSING')`,
    [tenantId, tableA]
  )).rows[0];
  assert.ok(open, "ต้องมีโต๊ะที่ปิดเวลาแล้วรอเก็บเงินจากเทสก่อนหน้า");
  const groups = await groupRows(open.id);
  assert.equal(groups.length, 2);

  const first = await payGroup(groups[0].id, Number(groups[0].amount_due));
  assert.equal(first.status, "SOLD", `เก็บเงินใบแรกไม่ผ่าน: ${JSON.stringify(first)}`);

  const afterFirst = await sessionRow(open.id);
  assert.equal(afterFirst.status, "CLOSING", "โต๊ะต้องยังไม่ว่างขณะที่ยังมีบิลค้าง");
  assert.equal(afterFirst.ended_at === null, false);
  // โต๊ะยังถูกจับจองอยู่ จึงเปิดโต๊ะใหม่ทับไม่ได้
  await assert.rejects(
    () => openSplitTable(tableA, 2),
    /โต๊ะ|duplicate key|23505/,
    "โต๊ะที่ยังมีบิลค้างต้องเปิดใหม่ไม่ได้"
  );

  const second = await payGroup(groups[1].id, Number(groups[1].amount_due));
  assert.equal(second.status, "SOLD", `เก็บเงินใบที่สองไม่ผ่าน: ${JSON.stringify(second)}`);
  assert.equal((await sessionRow(open.id)).status, "PAID", "จ่ายครบทุกบิลแล้วโต๊ะต้องว่าง");

  // โต๊ะว่างแล้วจึงเปิดใหม่ได้
  const reopened = await openSplitTable(tableA, 2);
  await cancelBoardGameSession(tenantId, reopened.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("each paid bill is its own order, and the order records both the group and the table visit", async () => {
  const rows = (await query<{ n: string; sessions: string }>(
    `SELECT count(*)::text AS n, count(DISTINCT board_game_session_id)::text AS sessions
       FROM bms_orders
      WHERE tenant_id = $1 AND board_game_billing_group_id IS NOT NULL`,
    [tenantId]
  )).rows[0];
  assert.equal(Number(rows.n), 3, "สองบิลของโต๊ะที่แยกกลุ่ม + หนึ่งบิลของโต๊ะกลุ่มเดียว");
  const orphan = (await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_orders
      WHERE tenant_id = $1 AND board_game_billing_group_id IS NOT NULL
        AND board_game_session_id IS NULL`,
    [tenantId]
  )).rows[0];
  assert.equal(Number(orphan.n), 0, "บิลที่รู้กลุ่มแต่ไม่รู้โต๊ะคือบิลที่ตามกลับไม่ได้");
});

test("a bill that is already settled cannot be claimed by a second order", async () => {
  const settled = (await query<{ id: string; amount_due: string }>(
    `SELECT id, amount_due::text FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND status = 'PAID' LIMIT 1`,
    [tenantId]
  )).rows[0];
  const again = await payGroup(settled.id, Number(settled.amount_due));
  assert.notEqual(again.status, "SOLD", "บิลที่จ่ายแล้วต้องเก็บเงินซ้ำไม่ได้");
});

test("a closed bill refuses new players while the table around it keeps taking them", async () => {
  // ⚠️ ต้องเป็นโต๊ะที่ **ยังเปิดอยู่** แต่มีกลุ่มหนึ่งปิดไปแล้ว ไม่งั้นด่านของ session
  // (`status = 'OPEN'`) จะปฏิเสธไปก่อน แล้วเทสนี้จะเขียวโดยไม่เคยแตะด่านของกลุ่มเลย
  // — สถานะนี้คือรูปทรงของ "ปิดบิลทีละกลุ่ม" ที่จะมาในเฟสถัดไป จึงป้อนแถวให้ตรงรูปเอา
  const session = await openSplitTable(tableB, 4);
  const groups = await groupRows(session.id);
  // ยอดกับ snapshot ต้องตรงกัน ไม่งั้น `createOrderInTx` ปฏิเสธบิลนี้ตอนเก็บเงินและโต๊ะจะค้าง
  const frozen = [{
    participantId: groups[1].id, displayName: "FAKE frozen", participantType: "GENERAL",
    billingGroupNo: 2, billableMinutes: 60, hourlyRate: 60, amount: 60,
  }];
  await query(
    `UPDATE bms_board_game_billing_groups
        SET status = 'CLOSING', ended_at = now(), amount_due = 60,
            charge_snapshot = $4::jsonb,
            settlement_idempotency_key = $3, settlement_request_hash = 'fake-hash'
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, groups[1].id, key("partial-close"), JSON.stringify(frozen)]
  );
  assert.equal((await sessionRow(session.id)).status, "OPEN", "โต๊ะต้องยังเปิดอยู่ตอนทดสอบด่านของกลุ่ม");

  await assert.rejects(
    () => addBoardGameParticipant(
      tenantId,
      { sessionId: session.id, idempotencyKey: key("add"), rateId, displayName: "FAKE late", billingGroupNo: 2 },
      staffId
    ),
    /กลุ่มบิล 2 ปิดไปแล้ว/,
    "คนที่เข้ากลุ่มที่ปิดแล้วจะไม่มีทางถูกคิดเงิน เพราะบรรทัดค่าเล่นถูกแช่ไปแล้ว"
  );
  // กลุ่มที่ยังเปิดอยู่ของโต๊ะเดียวกันต้องยังรับคนได้ตามปกติ
  const joined = await addBoardGameParticipant(
    tenantId,
    { sessionId: session.id, idempotencyKey: key("add"), rateId, displayName: "FAKE ok", billingGroupNo: 1 },
    staffId
  );
  assert.equal(joined.billingGroupNo, 1);
  assert.equal(joined.billingGroupId, groups[0].id);

  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  for (const group of await groupRows(session.id)) await payGroup(group.id, Number(group.amount_due));
});

test("one group can stop, pay and leave while the other group keeps playing", async () => {
  const session = await openSplitTable(tableB, 4);
  const groups = await groupRows(session.id);
  const closeKey = key("close-group");
  await addSnack(groups[0].id, 2);

  const closed = await closeBoardGameBillingGroupForBilling(
    tenantId,
    groups[0].id,
    { idempotencyKey: closeKey },
    staffId,
  );
  assert.equal(closed.groups.length, 1, "คำสั่งต้องตรึงเฉพาะบิลที่เลือก");
  assert.equal(closed.groups[0].id, groups[0].id);
  assert.equal(closed.groups[0].status, "CLOSING");
  assert.equal(closed.groups[0].tabAmount, 50, "ของบน tab ต้องตามกลุ่มแรกไปบิลเดียวกัน");
  assert.ok(closed.groups[0].chargeSnapshot.every((line) => line.billingGroupNo === 1));

  const during = await sessionRow(session.id);
  assert.equal(during.status, "OPEN", "กลุ่มอื่นยังเล่นอยู่ โต๊ะต้องยัง OPEN");
  assert.equal(during.ended_at, null, "ปิดคนหนึ่งไม่ใช่เวลาจบของทั้งโต๊ะ");
  assert.equal(Number(during.guest_count), 2, "นับเฉพาะคนในกลุ่มที่ยังจับเวลาอยู่");

  const paid = await payGroup(
    groups[0].id,
    money(closed.groups[0].amountDue + closed.groups[0].tabAmount),
  );
  assert.equal(paid.status, "SOLD");
  assert.equal((await sessionRow(session.id)).status, "OPEN", "รับเงินใบแรกแล้วห้ามปล่อยโต๊ะ");

  const late = await addBoardGameParticipant(
    tenantId,
    {
      sessionId: session.id,
      idempotencyKey: key("add-after-partial-payment"),
      rateId,
      displayName: "FAKE still playing",
      billingGroupNo: 2,
    },
    staffId,
  );
  assert.equal(late.billingGroupId, groups[1].id, "กลุ่มที่ยังเปิดต้องรับคนเพิ่มได้");

  const last = await closeBoardGameBillingGroupForBilling(
    tenantId,
    groups[1].id,
    { idempotencyKey: key("close-last-group") },
    staffId,
  );
  assert.equal((await sessionRow(session.id)).status, "CLOSING");
  await payGroup(groups[1].id, last.groups[0].amountDue);
  assert.equal((await sessionRow(session.id)).status, "PAID");
});

test("closing one group is idempotent and a second request cannot move its frozen time", async () => {
  const session = await openSplitTable(tableB, 4);
  const groups = await groupRows(session.id);
  const closeKey = key("close-group");
  const first = await closeBoardGameBillingGroupForBilling(
    tenantId, groups[0].id, { idempotencyKey: closeKey }, staffId
  );
  const replay = await closeBoardGameBillingGroupForBilling(
    tenantId, groups[0].id, { idempotencyKey: closeKey }, staffId
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.groups, first.groups, "retry ต้องคืน snapshot เดิมทุกบรรทัด");
  await assert.rejects(
    () => closeBoardGameBillingGroupForBilling(
      tenantId, groups[0].id, { idempotencyKey: key("close-group-other") }, staffId
    ),
    /คำขออื่น/,
  );

  await payGroup(groups[0].id, first.groups[0].amountDue);
  const rest = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close-rest") }, staffId
  );
  assert.deepEqual(rest.groups.map((group) => group.id), [groups[1].id]);
  await payGroup(groups[1].id, rest.groups[0].amountDue);
});

test("a group may leave while a game is still in use, but the final group must return it", async () => {
  const session = await openSplitTable(tableB, 4);
  const groups = await groupRows(session.id);
  const titleId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_titles (tenant_id, title)
     VALUES ($1,$2) RETURNING id`,
    [tenantId, `FAKE ${TAG} partial-close game ${Date.now()}`]
  )).rows[0].id;
  const copyId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_copies
       (tenant_id, title_id, location_id, copy_code, status)
     VALUES ($1,$2,$3,$4,'IN_USE') RETURNING id`,
    [tenantId, titleId, locationId, `FAKE-PC-${Date.now()}`]
  )).rows[0].id;
  const loanId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_session_games (tenant_id, session_id, copy_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, session.id, copyId]
  )).rows[0].id;

  const first = await closeBoardGameBillingGroupForBilling(
    tenantId, groups[0].id, { idempotencyKey: key("close-with-game") }, staffId
  );
  assert.equal(first.groups[0].status, "CLOSING", "เกมเป็นของโต๊ะ กลุ่มอื่นจึงเล่นต่อได้");
  await assert.rejects(
    () => closeBoardGameBillingGroupForBilling(
      tenantId, groups[1].id, { idempotencyKey: key("close-final-with-game") }, staffId
    ),
    /รับคืนเกมทุกกล่องก่อนปิดบิลสุดท้าย/,
  );

  await query(
    `UPDATE bms_board_game_session_games
        SET status = 'RETURNED', returned_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loanId]
  );
  await query(
    `UPDATE bms_board_game_copies SET status = 'AVAILABLE', updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, copyId]
  );
  const last = await closeBoardGameBillingGroupForBilling(
    tenantId, groups[1].id, { idempotencyKey: key("close-final-after-return") }, staffId
  );
  await payGroup(groups[0].id, first.groups[0].amountDue);
  await payGroup(groups[1].id, last.groups[0].amountDue);
});

test("closing again with the same key replays; a different key is a conflict", async () => {
  const session = await openSplitTable(tableB, 2);
  const closeKey = key("close");
  const first = await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: closeKey }, staffId);
  assert.equal(first.replayed, false);
  const replay = await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: closeKey }, staffId);
  assert.equal(replay.replayed, true, "ยิงซ้ำด้วยคีย์เดิมต้องได้ผลเดิม ไม่ใช่บิลใบใหม่");
  assert.equal(replay.amountDue, first.amountDue);
  await assert.rejects(
    () => closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId),
    /คำขออื่น/,
    "คนอื่นปิดบิลไปแล้วต้องรู้ตัว ไม่ใช่ได้ผลของคนแรกไปเงียบ ๆ"
  );
  const groups = await groupRows(session.id);
  for (const group of groups) await payGroup(group.id, Number(group.amount_due));
});

test("the checkout read is keyed by the bill and says whether the table has other bills waiting", async () => {
  const session = await openSplitTable(tableB, 4);
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  const groups = await groupRows(session.id);
  const checkout = await getBoardGameCheckoutForPos(tenantId, locationId, groups[1].id);
  assert.equal(checkout.id, groups[1].id);
  assert.equal(checkout.sessionId, session.id);
  assert.equal(checkout.groupNo, 2);
  assert.equal(checkout.sessionGroupCount, 2, "พนักงานต้องรู้ว่าโต๊ะนี้ยังมีบิลอีกใบ");
  assert.equal(checkout.amountDue, Number(groups[1].amount_due));
  assert.equal(checkout.chargeLines.length, 2, "checkout ต้องอธิบายค่าเล่นเป็นรายคน ไม่ใช่แค่ยอดรวม");
  for (const line of checkout.chargeLines) {
    assert.ok(line.rateName, "ชื่อเรทต้องถูกแช่ไว้เพื่อไม่ให้การเปลี่ยนชื่อแก้ใบเสร็จเก่า");
    assert.ok(line.joinedAt, "ต้องมีเวลาเข้าของผู้เล่น");
    assert.ok(line.actualEndedAt, "ต้องมีเวลาออก/เวลาปิดจริง");
    assert.ok(line.chargedUntil, "ต้องมีเวลาสิ้นสุดที่ใช้คิดเงิน");
    assert.ok(Number(line.actualMinutes) > 0);
    assert.ok(line.billableMinutes > 0);
  }
  // id ของโต๊ะไม่ใช่ id ของบิล — ส่งผิดตัวต้องหาไม่เจอ ไม่ใช่เดาให้
  await assert.rejects(
    () => getBoardGameCheckoutForPos(tenantId, locationId, session.id),
    /ไม่พบบิลเวลาเล่น/
  );
  for (const group of groups) await payGroup(group.id, Number(group.amount_due));
});

test("the floor tells the counter that a table is split and how many bills are still unpaid", async () => {
  const session = await openSplitTable(tableB, 4);
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  const groups = await groupRows(session.id);
  await payGroup(groups[0].id, Number(groups[0].amount_due));

  const floor = await listBoardGameFloor(tenantId, locationId);
  const table = floor.tables.find((row) => row.id === tableB);
  assert.ok(table?.openSession, "โต๊ะที่ยังมีบิลค้างต้องยังไม่ว่างบนผัง");
  assert.equal(table.openSession.billingGroupCount, 2);
  assert.equal(table.openSession.awaitingPaymentCount, 1, "เหลือบิลที่ยังไม่ได้เก็บอีกหนึ่งใบ");
  // ยอดบนการ์ดโต๊ะ = ผลรวมของบิลทุกใบที่ยังไม่ถูกยกเลิก
  assert.equal(
    table.openSession.amountDue,
    Math.round(groups.reduce((sum, group) => sum + Number(group.amount_due), 0) * 100) / 100
  );
  await payGroup(groups[1].id, Number(groups[1].amount_due));
});

test("a player who leaves stops being counted, and the table empties without closing the bill", async () => {
  const session = await openSplitTable(tableB, 2);
  const detail = await getBoardGameSession(tenantId, session.id);
  assert.equal((await sessionRow(session.id)).guest_count, 2);
  for (const person of detail.participants) {
    await leaveBoardGameParticipant(
      tenantId, { sessionId: session.id, participantId: person.id, idempotencyKey: key("leave") }, staffId
    );
  }
  const after = await sessionRow(session.id);
  assert.equal(after.guest_count, 0, "คนออกหมดแล้วต้องไม่นับว่ายังมีคนนั่งอยู่");
  assert.equal(after.status, "OPEN", "คนออกไม่ใช่การปิดบิล — เงินยังไม่ถูกคิด");
  await cancelBoardGameSession(tenantId, session.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("cancelling a table cancels every bill, and a table with a paid bill cannot be cancelled", async () => {
  const session = await openSplitTable(tableB, 4);
  const cancelKey = key("cancel");
  await cancelBoardGameSession(tenantId, session.id, { idempotencyKey: cancelKey, reason: "FAKE reason" }, staffId);
  const groups = await groupRows(session.id);
  assert.ok(groups.every((group) => group.status === "CANCELLED"));
  assert.ok(groups.every((group) => Number(group.amount_due) === 0));
  assert.equal((await sessionRow(session.id)).status, "CANCELLED");
  const replay = await cancelBoardGameSession(
    tenantId, session.id, { idempotencyKey: cancelKey, reason: "FAKE reason" }, staffId
  );
  assert.equal(replay.replayed, true);

  const paidSession = await openSplitTable(tableB, 2);
  await closeBoardGameSessionForBilling(tenantId, paidSession.id, { idempotencyKey: key("close") }, staffId);
  const paidGroups = await groupRows(paidSession.id);
  await payGroup(paidGroups[0].id, Number(paidGroups[0].amount_due));
  await assert.rejects(
    () => cancelBoardGameSession(tenantId, paidSession.id, { idempotencyKey: key("cancel"), reason: "too late" }, staffId),
    /ชำระเงินแล้ว/,
    "ยกเลิกโต๊ะที่เก็บเงินไปแล้วต้องไม่ได้ — เงินที่รับมาแล้วต้องคืนผ่านเส้นทางคืนเงิน"
  );
  await payGroup(paidGroups[1].id, Number(paidGroups[1].amount_due));
});

const tabKey = (label: string) => key(label);

const stock = async () => (await query<{ current: string; reserved: string }>(
  `SELECT current_stock::text AS current, reserved_stock::text AS reserved
     FROM bms_inventory
    WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
  [tenantId, locationId, SNACK, SIZE]
)).rows[0];

async function addSnack(billingGroupId: string, packQty = 1) {
  return addBoardGameGroupItem(
    tenantId,
    {
      billingGroupId, locationId, idempotencyKey: tabKey("tab-add"),
      sku: SNACK, size: SIZE, packQty, deviceId, shiftId,
    },
    staffId
  );
}

test("ordering onto a tab reserves the stock immediately, because the snack is already gone", async () => {
  const session = await openSplitTable(tableB, 2);
  const groups = await groupRows(session.id);
  const before = await stock();

  const added = await addSnack(groups[0].id, 2);
  assert.equal(added.tabAmount, 50, "ของ 2 ชิ้นราคา 25 ต้องเป็นยอดของ tab");

  const after = await stock();
  assert.equal(after.current, before.current, "ยังไม่ได้ขาย สต็อกจริงต้องยังไม่ลด");
  assert.equal(
    Number(after.reserved) - Number(before.reserved), 2,
    "ของที่ยื่นให้ลูกค้าแล้วต้องถูกจองทันที ไม่ใช่รอตอนปิดโต๊ะ"
  );

  // ใบจองเป็นของที่ *สร้างจาก* รายการบน tab — ไม่ใช่บิลที่เก็บเงินไปแล้ว
  const reservation = (await query<{ status: string }>(
    `SELECT o.status FROM bms_orders o
      JOIN bms_board_game_billing_groups g
        ON g.tenant_id = o.tenant_id AND g.current_order_id = o.id
     WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, groups[0].id]
  )).rows[0];
  assert.equal(reservation?.status, "PENDING");

  await cancelBoardGameSession(tenantId, session.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("removing a line before paying releases what it held and keeps the row as history", async () => {
  const session = await openSplitTable(tableB, 2);
  const groups = await groupRows(session.id);
  const before = await stock();
  const added = await addSnack(groups[0].id, 3);

  const removed = await removeBoardGameGroupItem(
    tenantId,
    {
      billingGroupId: groups[0].id, locationId, itemId: added.itemId,
      idempotencyKey: key("tab-remove"), reason: "FAKE rung by mistake", deviceId, shiftId,
    },
    staffId
  );
  assert.equal(removed.tabAmount, 0, "เอาออกหมดแล้วยอดของ tab ต้องเป็นศูนย์");
  assert.deepEqual(await stock(), before, "ของที่เอาออกต้องถูกปล่อยคืนครบ");

  const row = (await query<{ status: string; cancel_reason: string | null }>(
    `SELECT status, cancel_reason FROM bms_board_game_group_items
      WHERE tenant_id = $1 AND id = $2`, [tenantId, added.itemId]
  )).rows[0];
  assert.equal(row.status, "CANCELLED", "แถวต้องอยู่เป็นประวัติ ไม่ใช่ถูกลบทิ้ง");
  assert.equal(row.cancel_reason, "FAKE rung by mistake");

  await cancelBoardGameSession(tenantId, session.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("closing bills the tab and the play time together, on one order, with no unreserved gap", async () => {
  const session = await openSplitTable(tableB, 2);
  const groups = await groupRows(session.id);
  const before = await stock();
  await addSnack(groups[0].id, 2);

  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closed.groups.length, 2, "ผู้เล่นสองคนถูกแยกเป็นกลุ่ม 1 และกลุ่ม 2");

  const checkout = await getBoardGameCheckoutForPos(tenantId, locationId, groups[0].id);
  assert.equal(checkout.tabAmount, 50, "ของบน tab ต้องยังอยู่หลังปิดเวลา");
  assert.ok(checkout.amountDue > 0, "ค่าเล่นต้องถูกแช่ไว้");
  assert.equal(checkout.totalDue, Math.round((checkout.amountDue + 50) * 100) / 100);
  assert.equal(checkout.tabItemCount, 1);
  assert.equal(checkout.tabItems.length, 1, "checkout ต้องคืนสินค้าและราคา ไม่ใช่เฉพาะจำนวนรายการ");
  assert.equal(checkout.tabItems[0].productName.includes("FAKE"), true);
  assert.equal(checkout.tabItems[0].quantity, 2);
  assert.equal(checkout.tabItems[0].amount, 50);
  assert.equal(checkout.tabPricingDiscountAmount, 0,
    "สินค้าที่ไม่มีโปรต้องไม่สร้างบรรทัดส่วนลดลวงบน checkout");

  // ระหว่างปิดเวลากับรับเงิน ของยังต้องถูกจองไว้ ไม่ใช่กลับไปว่างให้เครื่องอื่นขาย
  const held = await stock();
  assert.equal(Number(held.reserved) - Number(before.reserved), 2);

  const paid = await payGroup(groups[0].id, checkout.totalDue);
  assert.equal(paid.status, "SOLD", `เก็บเงินไม่ผ่าน: ${JSON.stringify(paid)}`);
  assert.equal(paid.total, checkout.totalDue, "ยอดที่เก็บต้องเท่ากับค่าเล่นบวกของบน tab");

  const sold = await stock();
  assert.equal(Number(before.current) - Number(sold.current), 2, "ขายแล้วสต็อกต้องลดจริง");
  assert.equal(Number(sold.reserved), Number(before.reserved), "การจองต้องถูกใช้ไปหมด ไม่ค้าง");

  // บิลเดียวจบ — ของบน tab กับค่าเล่นต้องไม่ถูกแยกเป็นสองออร์เดอร์
  const orders = (await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_orders
      WHERE tenant_id = $1 AND board_game_billing_group_id = $2
        AND status IN ('PENDING','PAID','COMPLETED')`,
    [tenantId, groups[0].id]
  )).rows[0];
  assert.equal(orders.n, "1");

  for (const group of await groupRows(session.id)) {
    if (group.status !== "PAID") {
      await payGroup(group.id, money(Number(group.amount_due) + Number(group.tab_amount)));
    }
  }
});

test("a closed bill refuses new lines, and a serial-tracked product never reaches a tab", async () => {
  const session = await openSplitTable(tableB, 2);
  const groups = await groupRows(session.id);
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  await assert.rejects(
    () => addSnack(groups[0].id),
    /ปิดไปแล้ว/,
    "บิลที่ปิดแล้วรับของเพิ่มไม่ได้ — ยอดถูกแช่และส่งให้เครื่องขายไปแล้ว"
  );
  for (const group of await groupRows(session.id)) await payGroup(group.id, money(Number(group.amount_due) + Number(group.tab_amount)));

  await query(`UPDATE bms_products SET serial_tracked = TRUE WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, SNACK]);
  const serialSession = await openSplitTable(tableB, 2);
  const serialGroups = await groupRows(serialSession.id);
  await assert.rejects(
    () => addSnack(serialGroups[0].id),
    /เลขเครื่อง/,
    "ของที่ต้องบันทึกเลขเครื่องไม่ผ่านด่านของตะกร้า จึงต้องไม่ขึ้น tab ตั้งแต่แรก"
  );
  await query(`UPDATE bms_products SET serial_tracked = FALSE WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, SNACK]);
  await cancelBoardGameSession(tenantId, serialSession.id, { idempotencyKey: key("cancel"), reason: "cleanup" }, staffId);
});

test("cancelling a table with a tab gives every reserved item back", async () => {
  const session = await openSplitTable(tableB, 2);
  const groups = await groupRows(session.id);
  const before = await stock();
  await addSnack(groups[0].id, 4);
  assert.equal(Number((await stock()).reserved) - Number(before.reserved), 4);

  await cancelBoardGameSession(
    tenantId, session.id, { idempotencyKey: key("cancel"), reason: "FAKE walked out" }, staffId
  );
  assert.deepEqual(await stock(), before, "ยกเลิกโต๊ะแล้วของที่จองไว้ต้องกลับมาขายได้ทั้งหมด");
});

test("capacity needs an explicit override and personal purchased time is frozen per player", async () => {
  const participants = Array.from({ length: 5 }, (_, index) => ({
    rateId,
    displayName: `FAKE capacity ${index + 1}`,
    billingGroupNo: 1,
  }));
  await assert.rejects(
    () => openBoardGameSession(
      tenantId,
      {
        idempotencyKey: key("capacity-refuse"), locationId, tableId: tableB,
        posDeviceId: deviceId, posShiftId: shiftId, participants,
      },
      staffId,
    ),
    /4 ที่นั่ง.*5 คน/,
  );
  const startedAt = new Date(Date.now() - 10 * 60_000);
  const session = await openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("capacity-override"), locationId, tableId: tableB,
      posDeviceId: deviceId, posShiftId: shiftId, allowOverCapacity: true,
      startedAt,
      participants: participants.map((participant, index) => index === 0 ? {
        ...participant,
        displayName: "FAKE personal 60",
        timeMode: "DURATION" as const,
        purchasedDurationMinutes: 60,
        joinedAt: startedAt,
      } : { ...participant, joinedAt: startedAt }),
    },
    staffId,
  );
  const detail = await getBoardGameSession(tenantId, session.id);
  const personal = detail.participants.find((person) => person.displayName === "FAKE personal 60")!;
  assert.equal(personal.timeMode, "DURATION");
  assert.equal(
    new Date(personal.plannedEndAt!).getTime(),
    startedAt.getTime() + 60 * 60_000,
  );
  const closed = await closeBoardGameSessionForBilling(
    tenantId,
    session.id,
    { idempotencyKey: key("close-personal"), endedAt: new Date() },
    staffId,
  );
  assert.equal(
    closed.lines.find((line) => line.participantId === personal.id)?.chargedUntil,
    personal.plannedEndAt,
    "closing early must still charge through the player's purchased boundary",
  );
  await payGroup(closed.groups[0].id, closed.groups[0].amountDue);
});

test("two open groups can merge into one bill before close", async () => {
  const session = await openSplitTable(tableA, 4);
  const groups = await groupRows(session.id);
  await addSnack(groups[0].id, 1);
  const cancelled = await addSnack(groups[1].id, 1);
  await removeBoardGameGroupItem(
    tenantId,
    {
      billingGroupId: groups[1].id, locationId, itemId: cancelled.itemId,
      idempotencyKey: key("merge-cancelled-line"), reason: "FAKE keep source history",
      deviceId, shiftId,
    },
    staffId,
  );
  await addSnack(groups[1].id, 2);
  await mergeBoardGameBillingGroups(
    tenantId,
    {
      sourceBillingGroupId: groups[1].id,
      targetBillingGroupId: groups[0].id,
      locationId, deviceId, shiftId, idempotencyKey: key("merge-groups"),
    },
    staffId,
  );
  const after = await groupRows(session.id);
  assert.equal(after.find((group) => group.id === groups[1].id)?.status, "MERGED");
  assert.equal(Number(after.find((group) => group.id === groups[0].id)?.tab_amount), 75);
  const cancelledHistory = (await query<{ billing_group_id: string; status: string }>(
    `SELECT billing_group_id, status FROM bms_board_game_group_items
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, cancelled.itemId],
  )).rows[0];
  assert.equal(cancelledHistory.status, "CANCELLED");
  assert.equal(
    cancelledHistory.billing_group_id,
    groups[1].id,
    "a cancelled source line stays with the merged source as audit history",
  );
  const detail = await getBoardGameSession(tenantId, session.id);
  assert.equal(detail.billingGroups.length, 1, "merged history is not another active bill");
  assert.ok(detail.participants.every((person) => person.billingGroupId === groups[0].id));
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close-merged") }, staffId,
  );
  assert.equal(closed.groups.length, 1);
  await payGroup(closed.groups[0].id, money(closed.groups[0].amountDue + closed.groups[0].tabAmount));
});

test("one open group can detach to a free table while the other stays", async () => {
  const startedAt = new Date(Date.now() - 10 * 60_000);
  const session = await openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open-fixed-detach"), locationId, tableId: tableA,
      billingMode: "FIXED_DURATION", expectedDurationMinutes: 120,
      posDeviceId: deviceId, posShiftId: shiftId, startedAt,
      participants: Array.from({ length: 4 }, (_, index) => ({
        rateId,
        displayName: `FAKE fixed detach ${index + 1}`,
        billingGroupNo: index % 2 === 0 ? 1 : 2,
      })),
    },
    staffId,
  );
  const groups = await groupRows(session.id);
  const detached = await detachBoardGameBillingGroupToTable(
    tenantId,
    {
      billingGroupId: groups[0].id,
      targetTableId: tableC,
      idempotencyKey: key("detach-group"),
    },
    staffId,
  );
  assert.notEqual(detached.sessionId, session.id);
  const source = await getBoardGameSession(tenantId, session.id);
  const moved = await getBoardGameSession(tenantId, detached.sessionId);
  assert.equal(source.billingGroups.length, 1);
  assert.equal(moved.billingGroups.length, 1);
  assert.ok(source.participants.every((person) => person.billingGroupId === groups[1].id));
  assert.ok(moved.participants.every((person) => person.billingGroupId === groups[0].id));
  assert.equal(moved.tableId, tableC);
  assert.equal(moved.billingMode, "FIXED_DURATION");
  assert.equal(
    moved.expectedEndAt,
    source.expectedEndAt,
    "detaching a group keeps the purchased table-time boundary and its alert context",
  );
  await cancelBoardGameSession(
    tenantId, source.id, { idempotencyKey: key("cancel-source"), reason: "cleanup" }, staffId,
  );
  await cancelBoardGameSession(
    tenantId, moved.id, { idempotencyKey: key("cancel-detached"), reason: "cleanup" }, staffId,
  );
});

test("the session's own money columns stay untouched history", async () => {
  // `9.89` ย้ายเงินไปที่กลุ่มทั้งหมด · ถ้ามีโค้ดไหนยังเขียนคอลัมน์เดิมอยู่ สองแถวจะเริ่ม
  // ตอบไม่ตรงกันว่าโต๊ะนี้เป็นหนี้เท่าไร ซึ่งเป็นสิ่งที่ไล่ต้นเหตุได้ยากที่สุด
  const drift = (await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_board_game_sessions
      WHERE tenant_id = $1
        AND (amount_due <> 0
             OR jsonb_array_length(charge_snapshot) <> 0
             OR current_order_id IS NOT NULL
             OR settlement_idempotency_key IS NOT NULL
             OR cancel_idempotency_key IS NOT NULL)`,
    [tenantId]
  )).rows[0];
  assert.equal(Number(drift.n), 0, "session ต้องไม่ถือเงินอีกต่อไป — กลุ่มบิลเป็นเจ้าของ");
});

test("teardown: the throwaway cafe leaves nothing behind", async () => {
  const ids = [tenantId].filter(Boolean);
  if (!ids.length) return;
  // order ชี้ไปที่กลุ่ม และกลุ่มชี้กลับมาที่ order — ต้องปลดข้างหนึ่งก่อน ไม่งั้นลบไม่ได้ทั้งคู่
  await query(
    `UPDATE bms_orders SET board_game_session_id = NULL, board_game_billing_group_id = NULL
      WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_board_game_session_games",
    "bms_board_game_session_participants",
    "bms_board_game_billing_groups",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_orders",
    "bms_board_game_sessions",
    // ที่นั่ง (`9.91`) ถือ FK ไปที่โต๊ะ — ลบโต๊ะก่อนจะติด แล้ว teardown ที่ติดจะทิ้งร้านทดสอบไว้ในฐาน
    "bms_board_game_seatings",
    "bms_board_game_copies",
    "bms_board_game_titles",
    "bms_board_game_tables",
    "bms_board_game_areas",
    "bms_board_game_time_rates",
    "bms_board_game_idempotency_results",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
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
