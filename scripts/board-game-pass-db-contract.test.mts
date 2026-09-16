/**
 * Board-game member passes (`9.92`) against a real Postgres.
 *
 * A pass is time the member already paid for. What this suite pins down is the seam between
 * that entitlement and the one money formula:
 *
 *  - the frozen charge and the spent minutes are written in the **same** transaction, so a bill
 *    can never be discounted without the quota moving, or the quota move without the discount;
 *  - closing twice with the same key must not spend the quota twice — the register retries on an
 *    unknown network result, and a member losing an hour to a retry is money;
 *  - cancelling a table that had already been closed gives the minutes back, because nobody paid;
 *  - an expired or cancelled pass covers nothing, and a bundle that runs out mid-session charges
 *    the remainder rather than going negative.
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
  boardGamePassOutstanding,
  cancelBoardGameMemberPass,
  cancelBoardGameSession,
  closeBoardGameSessionForBilling,
  getBoardGameCheckoutForPos,
  issueBoardGameMemberPass,
  listBoardGameMemberPasses,
  listBoardGamePassPlans,
  locationOfBoardGameMemberPass,
  locationOfBoardGamePassPlan,
  openBoardGameSession,
  upsertBoardGamePassPlan,
} from "../apps/web/lib/bms/boardGameCafe.ts";
import { recordPosSale } from "../apps/web/lib/bms/pos.ts";

const TAG = "bg-pass-test";

let tenantId = "";
let locationId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
let rateId = "";
let memberId = "";
let walkInId = "";
const tables: Record<string, string> = {};

let seq = 0;
const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++seq}`;
const money = (value: number) => Math.round(value * 100) / 100;

const passRow = async (id: string) =>
  (await query<{ status: string; remaining_minutes: string | null; kind: string }>(
    `SELECT status, remaining_minutes, kind
       FROM bms_board_game_member_passes WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )).rows[0];

const ledgerOf = async (passId: string) =>
  (await query<{ kind: string; minutes: string; covered_amount: string }>(
    `SELECT kind, minutes, covered_amount
       FROM bms_board_game_pass_ledger
      WHERE tenant_id = $1 AND pass_id = $2
      ORDER BY id`,
    [tenantId, passId]
  )).rows;

const groupsOf = async (sessionId: string) =>
  (await query<{ id: string; amount_due: string; tab_amount: string; charge_snapshot: any }>(
    `SELECT id, amount_due::text, tab_amount::text, charge_snapshot
       FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY group_no`,
    [tenantId, sessionId]
  )).rows;

/**
 * สมาชิกใหม่ต่อเทสหนึ่งตัว — ใช้คนเดิมซ้ำแล้วแพ็กเกจของเทสก่อนหน้าจะมาช่วยจ่ายให้ด้วย
 * (ซึ่งเป็นพฤติกรรมที่ถูก: ไม่อั้นชนะแบบโควตา) แล้วเทสจะแดงด้วยเหตุผลที่ไม่ใช่สิ่งที่กำลังตรึง
 */
async function newMember(label: string) {
  return (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, member_no, tags)
     VALUES ($1,$2,$3,ARRAY['fake']) RETURNING id`,
    [tenantId, `FAKE ${TAG} ${label}`, `FAKE-${label}-${Date.now()}-${++seq}`]
  )).rows[0].id;
}

/** เปิดโต๊ะย้อนหลังไปตามนาทีที่กำหนด เพื่อให้มีเวลาคิดเงินจริงโดยไม่ต้องรอในเทส */
async function openWithMember(tableId: string, minutesAgo: number, customerId: string | null) {
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
      participants: [{ rateId, displayName: "FAKE member", customerId, participantType: "MEMBER" }],
    },
    staffId
  );
}

async function payGroup(billingGroupId: string, amount: number) {
  const result = await recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: staffId,
    idempotencyKey: key("sale"),
    lines: [],
    boardGameBillingGroupId: billingGroupId,
    payments: amount > 0 ? [{ method: "CASH", amount }] : [],
  });
  assert.equal(result.status, "SOLD", `เก็บเงินไม่ผ่าน: ${JSON.stringify(result)}`);
  return result;
}

test("setup: a throwaway board-game cafe with one member and one walk-in", async () => {
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
  for (const code of ["T1", "T2", "T3"]) {
    tables[code] = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
       VALUES ($1,$2,$3,$4,$5,6) RETURNING id`,
      [tenantId, locationId, areaId, `FAKE-${code}`, `FAKE ${TAG} ${code}`]
    )).rows[0].id;
  }
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes, rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_MEMBER',$2,'MEMBER',60,60,60,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`]
  )).rows[0].id;
  // เรทสมาชิกรับได้เฉพาะลูกค้าที่สมัครสมาชิกจริง (`7.96`) — `member_no` คือด่านนั้น
  memberId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, member_no, tags)
     VALUES ($1,$2,$3,ARRAY['fake']) RETURNING id`,
    [tenantId, `FAKE ${TAG} member`, `FAKE-M-${Date.now()}`]
  )).rows[0].id;
  walkInId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, member_no, tags)
     VALUES ($1,$2,$3,ARRAY['fake']) RETURNING id`,
    [tenantId, `FAKE ${TAG} second member`, `FAKE-M2-${Date.now()}`]
  )).rows[0].id;
});

test("the plan catalogue refuses a shape nobody can explain", async () => {
  const unlimited = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE monthly unlimited", kind: "UNLIMITED", price: 990, durationDays: 30 },
    staffId
  );
  assert.equal(unlimited.kind, "UNLIMITED");
  assert.equal(unlimited.includedMinutes, null, "แพ็กเกจไม่อั้นต้องไม่มีโควตา");

  const bundle = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE ten hours", kind: "MINUTES", price: 500, durationDays: 90, includedMinutes: 600 },
    staffId
  );
  assert.equal(bundle.includedMinutes, 600);

  await assert.rejects(
    () => upsertBoardGamePassPlan(
      tenantId, { name: "FAKE broken", kind: "MINUTES", price: 100, durationDays: 30 }, staffId
    ),
    /จำนวนนาที/,
    "แพ็กเกจแบบโควตาที่ไม่บอกจำนวนนาทีคือแพ็กเกจที่ขายแล้วไม่มีใครรู้ว่าได้อะไร"
  );
  await assert.rejects(
    () => upsertBoardGamePassPlan(
      tenantId, { name: "FAKE broken 2", kind: "FOREVER", price: 100, durationDays: 30 }, staffId
    ),
    /ชนิดแพ็กเกจ/,
  );
  assert.equal((await listBoardGamePassPlans(tenantId)).length, 2);
});

test("an unlimited pass makes the frozen bill exactly zero and records what it covered", async () => {
  const plan = (await listBoardGamePassPlans(tenantId)).find((row) => row.kind === "UNLIMITED")!;
  const pass = await issueBoardGameMemberPass(
    tenantId, { customerId: memberId, planId: plan.id, idempotencyKey: key("issue") }, staffId
  );
  assert.equal(pass.remainingMinutes, null, "ไม่อั้น = ไม่มีโควตา ไม่ใช่โควตา 0");
  assert.equal(pass.pricePaid, 990, "ราคามาจากแพ็กเกจฝั่ง server ไม่ใช่จากผู้เรียก");

  const session = await openWithMember(tables.T1, 95, memberId);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  const line = closed.groups[0].chargeSnapshot[0];
  assert.equal(closed.amountDue, 0, "สมาชิกไม่อั้นต้องไม่เหลือค่าเวลาให้จ่าย");
  assert.ok((line.grossAmount ?? 0) > 0, "ยอดก่อนแพ็กเกจต้องยังถูกบันทึกไว้");
  assert.equal(line.coveredAmount, line.grossAmount, "แพ็กเกจจ่ายเต็มจำนวน");
  assert.equal(line.amount, 0);
  assert.equal(line.passId, pass.id);

  const ledger = await ledgerOf(pass.id);
  assert.deepEqual(ledger.map((row) => row.kind), ["ISSUE", "CONSUME"]);
  assert.equal(Number(ledger[1].minutes), -Number(line.coveredMinutes));
  assert.equal(Number(ledger[1].covered_amount), line.coveredAmount);
  assert.equal((await passRow(pass.id)).remaining_minutes, null, "ไม่อั้นต้องไม่มีอะไรให้หัก");

  // เครื่องขายต้องอธิบายได้ว่าทำไมค่าเล่นถึงเป็น 0
  const checkout = await getBoardGameCheckoutForPos(tenantId, locationId, closed.groups[0].id);
  assert.equal(checkout.amountDue, 0);
  assert.equal(checkout.passCoveredAmount, line.coveredAmount);

  await payGroup(closed.groups[0].id, 0);
  assert.equal(
    (await query<{ status: string }>(
      `SELECT status FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, session.id]
    )).rows[0].status,
    "PAID",
    "บิลศูนย์บาทต้องปิดได้ — ไม่งั้นโต๊ะของสมาชิกไม่อั้นค้างตลอดไป"
  );
});

test("an hour bundle is spent down, and the session that outruns it pays the rest", async () => {
  const plan = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE small bundle", kind: "MINUTES", price: 100, durationDays: 30, includedMinutes: 60 },
    staffId
  );
  const pass = await issueBoardGameMemberPass(
    tenantId, { customerId: walkInId, planId: plan.id, idempotencyKey: key("issue") }, staffId
  );
  assert.equal(pass.remainingMinutes, 60);

  // อัตราปัดทีละ 60 นาที · เล่น 95 นาทีจึงคิด 120 นาที = ฿120 และแพ็กเกจจ่ายให้ 60 นาที = ฿60
  const session = await openWithMember(tables.T2, 95, walkInId);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  const line = closed.groups[0].chargeSnapshot[0];
  assert.equal(line.billableMinutes, 120);
  assert.equal(line.grossAmount, 120);
  assert.equal(line.coveredMinutes, 60);
  assert.equal(line.coveredAmount, 60);
  assert.equal(closed.amountDue, 60, "ส่วนที่เกินโควตาต้องยังเก็บเงิน");
  assert.equal(Number((await passRow(pass.id)).remaining_minutes), 0);

  await payGroup(closed.groups[0].id, 60);

  // โควตาหมดแล้ว รอบถัดไปต้องจ่ายเต็ม ไม่ใช่ติดลบ
  const again = await openWithMember(tables.T3, 30, walkInId);
  const closedAgain = await closeBoardGameSessionForBilling(
    tenantId, again.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closedAgain.amountDue, 60);
  assert.equal(closedAgain.groups[0].chargeSnapshot[0].coveredMinutes, 0);
  assert.equal(Number((await passRow(pass.id)).remaining_minutes), 0, "โควตาต้องไม่ติดลบ");
  await payGroup(closedAgain.groups[0].id, 60);
});

test("issuing the same pass twice with one key sells one contract, and a changed request conflicts", async () => {
  const plan = (await listBoardGamePassPlans(tenantId)).find((row) => row.kind === "UNLIMITED")!;
  const issueKey = key("issue");
  const first = await issueBoardGameMemberPass(
    tenantId, { customerId: walkInId, planId: plan.id, idempotencyKey: issueKey }, staffId
  );
  const replay = await issueBoardGameMemberPass(
    tenantId, { customerId: walkInId, planId: plan.id, idempotencyKey: issueKey }, staffId
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id, "ยิงซ้ำต้องได้สัญญาใบเดิม ไม่ใช่ใบที่สอง");
  assert.equal(
    (await listBoardGameMemberPasses(tenantId, { customerId: walkInId })).filter(
      (row) => row.id === first.id
    ).length,
    1
  );

  const other = (await listBoardGamePassPlans(tenantId)).find((row) => row.kind === "MINUTES")!;
  await assert.rejects(
    () => issueBoardGameMemberPass(
      tenantId, { customerId: walkInId, planId: other.id, idempotencyKey: issueKey }, staffId
    ),
    (error: unknown) => {
      assert.ok(isIdempotencyConflictError(error), `ต้องเป็น IdempotencyConflictError: ${error}`);
      return true;
    },
    "คีย์เดิมกับแพ็กเกจคนละใบต้องเป็น CONFLICT ที่ไคลเอนต์อ่านออก ไม่ใช่ 500"
  );
  await cancelBoardGameMemberPass(tenantId, first.id, { reason: "FAKE cleanup" }, staffId);
});

test("closing the same bill twice never spends the quota twice", async () => {
  const plan = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE replay bundle", kind: "MINUTES", price: 200, durationDays: 30, includedMinutes: 120 },
    staffId
  );
  const retryMember = await newMember("retry-member");
  const pass = await issueBoardGameMemberPass(
    tenantId, { customerId: retryMember, planId: plan.id, idempotencyKey: key("issue") }, staffId
  );
  const session = await openWithMember(tables.T1, 50, retryMember);
  const closeKey = key("close");
  const first = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: closeKey }, staffId
  );
  const replay = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: closeKey }, staffId
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.amountDue, first.amountDue);
  assert.equal(
    (await ledgerOf(pass.id)).filter((row) => row.kind === "CONSUME").length,
    1,
    "retry ของเครื่องขายต้องไม่กินโควตาของสมาชิกรอบที่สอง"
  );
  assert.equal(Number((await passRow(pass.id)).remaining_minutes), 60);
  await payGroup(first.groups[0].id, first.amountDue);
});

test("cancelling a table that was already closed gives the minutes back", async () => {
  const plan = (await listBoardGamePassPlans(tenantId)).find(
    (row) => row.kind === "MINUTES" && row.includedMinutes === 120
  )!;
  const refundMember = await newMember("refund-member");
  const pass = await issueBoardGameMemberPass(
    tenantId, { customerId: refundMember, planId: plan.id, idempotencyKey: key("issue") }, staffId
  );
  const session = await openWithMember(tables.T2, 50, refundMember);
  await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
  assert.equal(Number((await passRow(pass.id)).remaining_minutes), 60, "ปิดบิลแล้วโควตาต้องถูกหัก");

  await cancelBoardGameSession(
    tenantId, session.id, { idempotencyKey: key("cancel"), reason: "FAKE walked out" }, staffId
  );
  assert.equal(
    Number((await passRow(pass.id)).remaining_minutes),
    120,
    "ไม่มีใครจ่ายเงิน เวลาในแพ็กเกจต้องกลับมาครบ"
  );
  const ledger = await ledgerOf(pass.id);
  assert.deepEqual(ledger.map((row) => row.kind), ["ISSUE", "CONSUME", "REVERSE"]);
  assert.equal(
    Number(ledger[1].minutes) + Number(ledger[2].minutes),
    0,
    "ledger ต้องบวกกลับเป็นศูนย์ ไม่ใช่ลบแถวที่เคยเกิดขึ้นทิ้ง"
  );
});

test("a cancelled or expired pass covers nothing", async () => {
  const plan = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE dead bundle", kind: "MINUTES", price: 200, durationDays: 30, includedMinutes: 600 },
    staffId
  );
  const cancelled = await issueBoardGameMemberPass(
    tenantId, { customerId: walkInId, planId: plan.id, idempotencyKey: key("issue") }, staffId
  );
  await cancelBoardGameMemberPass(tenantId, cancelled.id, { reason: "FAKE refunded" }, staffId);

  const expired = await issueBoardGameMemberPass(
    tenantId,
    {
      customerId: walkInId, planId: plan.id, idempotencyKey: key("issue"),
      startsAt: new Date(Date.now() - 400 * 86_400_000),
    },
    staffId
  );
  const stillActive = (await listBoardGameMemberPasses(
    tenantId, { customerId: walkInId, activeOnly: true }
  )).map((row) => row.id);
  assert.ok(!stillActive.includes(cancelled.id), "สัญญาที่ยกเลิกแล้วต้องไม่ขึ้นเป็นของที่ใช้ได้");
  assert.ok(!stillActive.includes(expired.id), "สัญญาที่หมดอายุแล้วต้องไม่ขึ้นเป็นของที่ใช้ได้");

  const session = await openWithMember(tables.T3, 30, walkInId);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closed.amountDue, 60, "ไม่มีแพ็กเกจที่ใช้ได้ = จ่ายเต็ม");
  assert.equal(closed.groups[0].chargeSnapshot[0].passId, null);
  assert.equal(Number((await passRow(expired.id)).remaining_minutes), 600, "แพ็กเกจที่หมดอายุต้องไม่ถูกแตะ");
  await payGroup(closed.groups[0].id, 60);
});

test("a member holding a spent bundle and a fresh one is covered by the one that can help", async () => {
  // สมาชิกซื้อแพ็กเกจใบใหม่หลังใบเก่าหมดโควตา · เลือกใบด้วย id เฉย ๆ จะไปเจอใบที่ใช้หมดแล้ว
  // แล้วบอกลูกค้าว่าแพ็กเกจที่เพิ่งจ่ายเงินไปช่วยอะไรไม่ได้
  const stacked = await newMember("stacked-member");
  const small = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE spent bundle", kind: "MINUTES", price: 50, durationDays: 30, includedMinutes: 60 },
    staffId
  );
  const spent = await issueBoardGameMemberPass(
    tenantId, { customerId: stacked, planId: small.id, idempotencyKey: key("issue") }, staffId
  );
  // ⚠️ ปั้นใบที่ใช้หมดแล้วต้องเขียน ledger ให้ตรงกันด้วย — ตั้งแต่ยอดเป็น cache ของ ledger
  // (`9.92`) การตั้งยอดเป็น 0 เฉย ๆ คือการปั้นสถานะที่ระบบจริงไปถึงไม่ได้ แล้วตัวจับ drift
  // จะรายงานว่าเพี้ยน ทั้งที่ของจริงไม่ได้เพี้ยน — fixture ที่โกหกทำให้ด่านจริงเลิกมีความหมาย
  await query(
    `UPDATE bms_board_game_member_passes SET remaining_minutes = 0
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, spent.id]
  );
  await query(
    `INSERT INTO bms_board_game_pass_ledger (tenant_id, pass_id, kind, minutes, note)
     VALUES ($1,$2,'ADJUST',$3,'FAKE spent before this test')`,
    [tenantId, spent.id, -60]
  );
  const fresh = await issueBoardGameMemberPass(
    tenantId, { customerId: stacked, planId: small.id, idempotencyKey: key("issue") }, staffId
  );

  const session = await openWithMember(tables.T1, 30, stacked);
  const closed = await closeBoardGameSessionForBilling(
    tenantId, session.id, { idempotencyKey: key("close") }, staffId
  );
  assert.equal(closed.groups[0].chargeSnapshot[0].passId, fresh.id, "ต้องใช้ใบที่ยังมีโควตา");
  assert.equal(closed.amountDue, 0);
  assert.equal(Number((await passRow(fresh.id)).remaining_minutes), 0);
  assert.equal(Number((await passRow(spent.id)).remaining_minutes), 0, "ใบที่หมดแล้วต้องไม่ติดลบ");
  await payGroup(closed.groups[0].id, 0);
});

test("a pass built for one branch cannot be sold at another", async () => {
  // `9.92` ประกาศกฎนี้ไว้ที่คอลัมน์เอง — ก่อนรอบนี้ไม่มีอะไรบังคับเลย: คอลัมน์ที่ประกาศกฎแล้ว
  // ไม่มีใครตรวจแย่กว่าไม่มีคอลัมน์ เพราะคนอ่านเชื่อว่ามีการกันอยู่
  const otherBranch = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'BR2',$2,'00002') RETURNING id`,
    [tenantId, `FAKE ${TAG} second branch`]
  )).rows[0].id;

  const branchPlan = await upsertBoardGamePassPlan(
    tenantId,
    { name: "FAKE branch-only pass", kind: "UNLIMITED", price: 500, durationDays: 30, locationId: otherBranch },
    staffId
  );
  assert.equal(await locationOfBoardGamePassPlan(tenantId, branchPlan.id), otherBranch);

  const buyer = await newMember("branch-scope");
  await assert.rejects(
    () => issueBoardGameMemberPass(
      tenantId,
      { customerId: buyer, planId: branchPlan.id, idempotencyKey: key("issue-wrong"), locationId },
      staffId
    ),
    /เฉพาะสาขา/,
    "ขายแพ็กเกจของอีกสาขาที่สาขานี้ไม่ได้",
  );
  await assert.rejects(
    () => issueBoardGameMemberPass(
      tenantId,
      { customerId: buyer, planId: branchPlan.id, idempotencyKey: key("issue-missing") },
      staffId
    ),
    /เฉพาะสาขา/,
    "ผู้เรียก service โดยตรงห้ามละสาขาเพื่อข้ามด่านแพ็กเกจผูกสาขา",
  );
  // ...แต่ขายที่สาขาของมันเองได้ตามปกติ
  const ok = await issueBoardGameMemberPass(
    tenantId,
    { customerId: buyer, planId: branchPlan.id, idempotencyKey: key("issue-right"), locationId: otherBranch },
    staffId
  );
  assert.equal(ok.status, "ACTIVE");
  assert.equal(ok.locationId, otherBranch);
  assert.equal(await locationOfBoardGameMemberPass(tenantId, ok.id), otherBranch);

  // ย้าย plan ภายหลังต้องไม่ย้ายสัญญาที่ขายไปแล้ว
  await upsertBoardGamePassPlan(
    tenantId,
    {
      id: branchPlan.id,
      name: branchPlan.name,
      kind: branchPlan.kind,
      price: branchPlan.price,
      durationDays: branchPlan.durationDays,
      includedMinutes: branchPlan.includedMinutes,
      locationId,
      active: branchPlan.active,
      sortOrder: branchPlan.sortOrder,
      note: branchPlan.note,
    },
    staffId
  );
  assert.equal(await locationOfBoardGameMemberPass(tenantId, ok.id), otherBranch,
    "สิทธิ์เก่าต้องคงสาขาที่ขาย แม้แคตตาล็อกถูกย้าย");

  const wrongBranchSession = await openWithMember(tables.T1, 30, buyer);
  const wrongBranchBill = await closeBoardGameSessionForBilling(
    tenantId, wrongBranchSession.id, { idempotencyKey: key("close-wrong-branch") }, staffId
  );
  assert.ok(wrongBranchBill.amountDue > 0, "แพ็กเกจของสาขาอื่นต้องไม่ช่วยจ่ายค่าเวลา");
  await payGroup(wrongBranchBill.groups[0].id, wrongBranchBill.amountDue);

  // แพ็กเกจระดับร้าน (location_id เป็น NULL) ขายได้ทุกสาขาตามนิยามของมันเอง
  const shopWide = (await listBoardGamePassPlans(tenantId)).find((plan) => plan.locationId == null);
  assert.ok(shopWide, "ต้องมีแพ็กเกจระดับร้านอยู่ในชุดทดสอบ");
  const anywhere = await issueBoardGameMemberPass(
    tenantId,
    { customerId: buyer, planId: shopWide.id, idempotencyKey: key("issue-shopwide"), locationId },
    staffId
  );
  assert.equal(anywhere.status, "ACTIVE");

  // แคตตาล็อกที่กรองตามสาขาต้องซ่อนแพ็กเกจของสาขาอื่น แต่ยังเห็นแพ็กเกจระดับร้าน
  const visibleHere = await listBoardGamePassPlans(tenantId, [locationId]);
  assert.ok(visibleHere.some((plan) => plan.id === branchPlan.id),
    "หลังย้ายแคตตาล็อกมาสาขานี้ plan ต้องมองเห็น แต่สิทธิ์เก่ายังคงอยู่สาขาเดิม");
  assert.ok(visibleHere.some((plan) => plan.id === shopWide.id), "แพ็กเกจระดับร้านต้องยังเห็นได้");
  const visiblePasses = await listBoardGameMemberPasses(tenantId, { visibleLocationIds: [locationId] });
  assert.ok(!visiblePasses.some((pass) => pass.id === ok.id), "สัญญาของสาขาอื่นต้องไม่รั่วในรายการ");
  const visibleOutstanding = await boardGamePassOutstanding(tenantId, [locationId]);
  assert.ok(visibleOutstanding.activeUnlimitedPasses >= 1, "แพ็กเกจระดับร้านยังต้องอยู่ในยอดที่มองเห็น");
});

test("the cached minute balance is measured against the ledger, not trusted", async () => {
  const before = await boardGamePassOutstanding(tenantId);
  assert.equal(
    before.balanceMismatchCount,
    0,
    "สถานะที่เทสชุดนี้สร้างไว้ต้องเป็นสถานะที่ระบบจริงไปถึงได้ — drift ตรงนี้คือ fixture ที่โกหก",
  );
  assert.ok(before.activeUnlimitedPasses > 0, "ต้องนับแพ็กเกจไม่อั้นเป็นจำนวนใบ ไม่ใช่ยัดเป็น 0 นาที");

  // ทำให้ยอดที่แคชไว้เพี้ยนโดยไม่แตะ ledger — นี่คือรูปของบั๊กที่กฎข้อนี้มีไว้จับ
  const bundle = (await query<{ id: string; remaining_minutes: string }>(
    `SELECT id, remaining_minutes FROM bms_board_game_member_passes
      WHERE tenant_id = $1 AND kind = 'MINUTES' AND remaining_minutes IS NOT NULL
      ORDER BY created_at LIMIT 1`,
    [tenantId]
  )).rows[0];
  assert.ok(bundle, "ต้องมีแพ็กเกจแบบโควตาให้ทดสอบ");
  await query(
    `UPDATE bms_board_game_member_passes SET remaining_minutes = remaining_minutes + 99
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, bundle.id]
  );
  assert.equal(
    (await boardGamePassOutstanding(tenantId)).balanceMismatchCount,
    1,
    "ยอดที่ไม่ตรงกับ ledger ต้องถูกจับได้ ไม่ใช่เพี้ยนเงียบ ๆ",
  );
  await query(
    `UPDATE bms_board_game_member_passes SET remaining_minutes = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, bundle.id, Number(bundle.remaining_minutes)]
  );
  assert.equal((await boardGamePassOutstanding(tenantId)).balanceMismatchCount, 0);
});

test("teardown: the throwaway cafe leaves nothing behind", async () => {
  const ids = [tenantId].filter(Boolean);
  if (!ids.length) return;
  await query(
    `UPDATE bms_orders SET board_game_session_id = NULL, board_game_billing_group_id = NULL
      WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_board_game_pass_ledger",
    "bms_board_game_member_passes",
    "bms_board_game_pass_plans",
    "bms_board_game_session_games",
    "bms_board_game_session_participants",
    "bms_board_game_group_items",
    "bms_board_game_billing_groups",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_orders",
    "bms_board_game_sessions",
    "bms_board_game_seatings",
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
