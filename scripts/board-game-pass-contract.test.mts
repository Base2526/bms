/**
 * แพ็กเกจสมาชิกของร้านบอร์ดเกม (`9.92`) — สูตรเงินและกติกาของโควตา
 *
 * ชุด DB พิสูจน์ว่าเส้นทางจริงเดินครบ แต่ `gate.yml` รันเฉพาะชุด pure · ตัวนี้จึงเป็นด่านเดียว
 * ที่ยิงทุก PR สำหรับเลขที่ลูกค้าจ่ายจริง · ทุก assert ที่เป็นเลขเรียกฟังก์ชันของจริง
 * ไม่ใช่สแกนซอร์สว่า "มีคำนี้อยู่ไหม"
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applyBoardGamePassCoverage,
  boardGamePassExpiry,
  type BoardGamePassBudget,
} from "../apps/web/lib/bms/boardGamePassCoverage.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const unlimited = (id: string): BoardGamePassBudget => ({ id, kind: "UNLIMITED", remainingMinutes: null });
const minutes = (id: string, remainingMinutes: number): BoardGamePassBudget =>
  ({ id, kind: "MINUTES", remainingMinutes });

test("a member without a pass pays exactly what the rate says", () => {
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 90, hourlyRate: 60 }],
    new Map()
  );
  assert.equal(line.grossAmount, 90);
  assert.equal(line.amount, 90);
  assert.equal(line.passId, null);
  assert.equal(line.coveredMinutes, 0);
  assert.equal(line.coveredAmount, 0);
});

test("an unlimited pass leaves exactly zero, even when the hour does not divide evenly", () => {
  // 35 นาที × ฿70/ชม. = 40.8333… · คิดส่วนที่ครอบแยกแล้วลบกัน จะเหลือเศษสตางค์ค้างบนบิล
  // ที่แคชเชียร์อธิบายไม่ได้ — แพ็กเกจไม่อั้นต้องเหลือ 0 พอดีเสมอ
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 35, hourlyRate: 70 }],
    new Map([["c1", unlimited("p1")]])
  );
  assert.equal(line.grossAmount, 40.83);
  assert.equal(line.coveredAmount, 40.83);
  assert.equal(line.amount, 0, "แพ็กเกจไม่อั้นต้องไม่เหลือเศษให้ลูกค้าจ่าย");
  assert.equal(line.coveredMinutes, 35);
  assert.equal(line.passId, "p1");
});

test("an hour bundle covers what is left and the member pays the rest", () => {
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 120, hourlyRate: 60 }],
    new Map([["c1", minutes("p1", 45)]])
  );
  assert.equal(line.grossAmount, 120);
  assert.equal(line.coveredMinutes, 45);
  assert.equal(line.coveredAmount, 45);
  assert.equal(line.amount, 75);
  assert.equal(line.grossAmount, line.amount + line.coveredAmount, "สองก้อนต้องบวกกลับเป็นยอดเต็ม");
});

test("what the member pays is the bill minus what the pass paid, never recomputed", () => {
  // 10 นาที ฿70/ชม. = 11.6666… -> 11.67 · ครอบ 5 นาที = 5.8333… -> 5.83
  // คิดใหม่จากนาทีที่เหลือได้ 5.83 ซึ่งบวกกลับแล้วขาดไปหนึ่งสตางค์ · ต้องหักออกจากยอดเต็ม
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 10, hourlyRate: 70 }],
    new Map([["c1", minutes("p1", 5)]])
  );
  assert.equal(line.grossAmount, 11.67);
  assert.equal(line.coveredAmount, 5.83);
  assert.equal(line.amount, 5.84);
  assert.equal(
    line.amount + line.coveredAmount,
    line.grossAmount,
    "ยอดที่จ่ายกับยอดที่แพ็กเกจช่วยต้องบวกกลับเป็นยอดเต็มเสมอ"
  );
});

test("a bundle that exactly covers the session leaves nothing to pay", () => {
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 90, hourlyRate: 80 }],
    new Map([["c1", minutes("p1", 90)]])
  );
  assert.equal(line.coveredMinutes, 90);
  assert.equal(line.amount, 0);
});

test("a spent bundle charges in full instead of going negative", () => {
  const [line] = applyBoardGamePassCoverage(
    [{ customerId: "c1", billableMinutes: 60, hourlyRate: 60 }],
    new Map([["c1", minutes("p1", 0)]])
  );
  assert.equal(line.coveredMinutes, 0);
  assert.equal(line.amount, 60);
  assert.equal(line.passId, null, "แพ็กเกจที่ไม่มีโควตาเหลือต้องไม่ถูกอ้างว่าช่วยจ่าย");
});

test("one bundle is shared across both lines of the same person, not given twice", () => {
  // คนเดิมออกจากโต๊ะแล้วกลับเข้ามาใหม่เป็นผู้เล่นอีกแถว — โควตาต้องเดินต่อ ไม่ใช่เริ่มใหม่
  const lines = applyBoardGamePassCoverage(
    [
      { customerId: "c1", billableMinutes: 60, hourlyRate: 60 },
      { customerId: "c1", billableMinutes: 60, hourlyRate: 60 },
    ],
    new Map([["c1", minutes("p1", 90)]])
  );
  assert.equal(lines[0].coveredMinutes, 60);
  assert.equal(lines[1].coveredMinutes, 30, "บรรทัดที่สองได้เฉพาะที่เหลือ");
  assert.equal(lines[0].amount + lines[1].amount, 30);
});

test("a line that costs nothing never burns a member's quota", () => {
  // ผู้ชมที่ไม่คิดเงิน หรือคนที่เพิ่งนั่งจนยังไม่มีนาทีคิดเงิน — เผานาทีทิ้งโดยไม่มีใครได้อะไร
  const lines = applyBoardGamePassCoverage(
    [
      { customerId: "c1", billableMinutes: 60, hourlyRate: 0 },
      { customerId: "c1", billableMinutes: 0, hourlyRate: 60 },
      { customerId: "c1", billableMinutes: 30, hourlyRate: 60 },
    ],
    new Map([["c1", minutes("p1", 60)]])
  );
  assert.equal(lines[0].coveredMinutes, 0);
  assert.equal(lines[1].coveredMinutes, 0);
  assert.equal(lines[2].coveredMinutes, 30, "โควตาต้องยังครบเมื่อมาถึงบรรทัดที่คิดเงินจริง");
  assert.equal(lines[2].amount, 0);
});

test("each member spends only their own pass", () => {
  const lines = applyBoardGamePassCoverage(
    [
      { customerId: "c1", billableMinutes: 60, hourlyRate: 60 },
      { customerId: "c2", billableMinutes: 60, hourlyRate: 60 },
      { customerId: null, billableMinutes: 60, hourlyRate: 60 },
    ],
    new Map([["c1", minutes("p1", 30)]])
  );
  assert.equal(lines[0].coveredMinutes, 30);
  assert.equal(lines[1].coveredMinutes, 0, "สมาชิกอีกคนต้องไม่ได้ใช้แพ็กเกจของคนแรก");
  assert.equal(lines[2].coveredMinutes, 0, "ลูกค้าที่ไม่ได้ผูกบัญชีไม่มีแพ็กเกจให้ใช้");
  assert.equal(lines[1].amount + lines[2].amount, 120);
});

test("a pass expires by the days it was sold with, not by calendar month", () => {
  const start = new Date("2026-01-31T10:00:00.000Z");
  assert.equal(boardGamePassExpiry(start, 30).toISOString(), "2026-03-02T10:00:00.000Z");
  assert.equal(boardGamePassExpiry(start, 1).toISOString(), "2026-02-01T10:00:00.000Z");
  // จำนวนวันที่ไม่ถูกต้องต้องยังได้สัญญาที่ใช้ได้อย่างน้อยหนึ่งวัน ไม่ใช่สัญญาที่หมดอายุไปแล้ว
  assert.ok(boardGamePassExpiry(start, 0) > start);
});

test("`9.92` keeps the balance in a ledger and the shape of each kind honest", () => {
  const sql = read("db/migrations/9.92__bms_board_game_member_passes.sql");

  for (const table of [
    "bms_board_game_pass_plans",
    "bms_board_game_member_passes",
    "bms_board_game_pass_ledger",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, new RegExp(`'${table}'`), `${table} is missing from the RLS/grant loop`);
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bms_app/);
  assert.match(sql, /GRANT USAGE, SELECT ON SEQUENCE bms_board_game_pass_ledger_id_seq TO bms_app/);
  assert.match(sql, /board_game\.pass\.manage/);

  // "ไม่อั้น" กับ "มีโควตา" ต้องแยกกันด้วยข้อมูล ไม่ใช่ด้วยความตั้งใจของคนกรอก
  assert.match(sql, /CHECK \(\(kind = 'MINUTES'\) = \(included_minutes IS NOT NULL\)\)/);
  assert.match(sql, /CHECK \(\(kind = 'MINUTES'\) = \(remaining_minutes IS NOT NULL\)\)/);
  assert.match(sql, /remaining_minutes IS NULL OR remaining_minutes >= 0/);

  // ปิดบิลซ้ำ/ยกเลิกซ้ำต้องไม่หักหรือคืนนาทีสองรอบ — ก้อนเดียวใช้ไม่ได้เพราะ CONSUME กับ
  // REVERSE ของคู่เดียวกันต้องอยู่ร่วมกันได้
  assert.match(
    sql,
    /uq_bms_board_game_pass_ledger_consume[\s\S]*?\(tenant_id, pass_id, billing_group_id, participant_id\)[\s\S]*?WHERE kind = 'CONSUME'/,
  );
  assert.match(
    sql,
    /uq_bms_board_game_pass_ledger_reverse[\s\S]*?\(tenant_id, pass_id, billing_group_id, participant_id\)[\s\S]*?WHERE kind = 'REVERSE'/,
  );
  assert.match(sql, /uq_bms_board_game_member_passes_issue_key/);
});

test("`9.94` snapshots branch scope and adds tenant-composite references", () => {
  const sql = read("db/migrations/9.94__bms_board_game_branch_scope_and_identity_hardening.sql");
  assert.match(sql, /ADD COLUMN location_id UUID/);
  assert.match(sql, /IF NOT EXISTS \([\s\S]*?column_name = 'location_id'/,
    "rerunning the migration must not resnapshot a pass from a plan moved later");
  assert.match(sql, /SET location_id = plan\.location_id/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id\)[\s\S]*?bms_locations\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, customer_id\)[\s\S]*?bms_customers\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, order_id\)[\s\S]*?bms_orders\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, pass_id\)[\s\S]*?bms_board_game_member_passes\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id, session_id\)[\s\S]*?bms_board_game_sessions\(tenant_id, location_id, id\)/);
});

test("minutes are spent when the bill is frozen, never while previewing it", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");

  // พรีวิวยอดเกิดได้ตลอดเวลาและหลายจอพร้อมกัน · หักโควตาตรงนั้นเมื่อไร สองโต๊ะจะกินใบเดียวกัน
  // สองรอบโดยไม่มีใครจ่ายเงินสักโต๊ะ
  const consumeCalls = [...service.matchAll(/await consumePassMinutesInTx\(/g)];
  assert.equal(consumeCalls.length, 1, "การหักโควตาต้องมีจุดเรียกเดียว");
  const closeBody = service.slice(
    service.indexOf("async function closeOpenBillingGroupInTx"),
    service.indexOf("export async function closeBoardGameBillingGroupForBilling"),
  );
  assert.ok(closeBody.length > 0, "closeOpenBillingGroupInTx must exist above the close command");
  assert.match(closeBody, /await consumePassMinutesInTx\(/, "หักโควตาตอนแช่ยอดเท่านั้น");

  // ต้องล็อกแพ็กเกจ **ก่อน** คิดยอด ไม่งั้นสองกลุ่มที่ปิดพร้อมกันอ่านโควตาเดิมแล้วหักทั้งคู่
  const lockAt = closeBody.indexOf("activePassesForGroupInTx(client, tenantId, group.id, endedAt, { lock: true })");
  const calcAt = closeBody.indexOf("calculateBoardGameGroupCharges(");
  assert.ok(lockAt >= 0, "the closing path must lock the passes it is about to spend");
  assert.ok(lockAt < calcAt, "แพ็กเกจต้องถูกล็อกก่อนคิดยอด");
  assert.ok(
    closeBody.indexOf("consumePassMinutesInTx") > closeBody.indexOf("charge_snapshot"),
    "หักโควตาหลังจาก snapshot ถูกเขียนแล้วเท่านั้น",
  );

  // ยกเลิกโต๊ะที่ปิดบิลไปแล้วต้องคืนนาทีให้สมาชิก — ไม่งั้นเวลาหายไปกับโต๊ะที่ไม่มีใครจ่ายเงิน
  const cancelBody = service.slice(service.indexOf("export async function cancelBoardGameSession"));
  assert.match(cancelBody, /await reversePassMinutesForGroupInTx\(/);
});

test("an elapsed pass is never presented to the counter as ACTIVE", () => {
  const service = read("apps/web/lib/bms/boardGameCafe.ts");
  const map = service.slice(
    service.indexOf("function mapMemberPass"),
    service.indexOf("export async function listBoardGamePassPlans"),
  );
  assert.match(map, /row\.status === "ACTIVE"[\s\S]*?new Date\(expiresAt\)[\s\S]*?"EXPIRED"/);
});

test("only a fully covered board-game bill may settle with no payment at all", () => {
  const pos = read("apps/web/lib/bms/pos.ts");

  // ยกเว้นให้กว้างกว่านี้เมื่อไร = บิลค้าปลีกที่ไม่มีใครจ่ายก็ผ่านได้ ซึ่งเป็นวิธีที่เงินหายเงียบที่สุด
  assert.match(
    pos,
    /if \(requestedPayments\.length === 0 && !input\.boardGameBillingGroupId\) \{\s*\n\s*return \{ status: "PAYMENT_FAILED"/,
    "the empty-payment escape must be scoped to a board-game bill, nothing else",
  );
  // ด่านที่ตัดสินว่า 0 ถูกหรือไม่คือ "ยอดชำระต้องเท่ายอดที่ต้องจ่าย" ซึ่งต้องยังอยู่
  assert.match(pos, /PAYMENT_MISMATCH/);
});
