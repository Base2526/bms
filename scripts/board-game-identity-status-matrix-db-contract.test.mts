/**
 * บัตรที่รับไว้ค้ำกล่องเกม (`9.93`) — **ตารางสถานะที่รองรับจริง**
 *
 * ไฟล์นี้ไม่ได้มีไว้ตรึงกฎข้อใดข้อหนึ่ง (ชุด `board-game-identity-db-contract` ทำแล้ว) แต่มีไว้
 * ตอบคำถามที่ตอบจากการอ่านโค้ดไม่ได้: **ตอนนี้ระบบรองรับบัตรในสถานะอะไร และแต่ละสถานะ
 * ทำอะไรได้บ้าง** — เพื่อให้เห็นว่าต้องเพิ่มอะไร
 *
 * วิธีตอบ: **เดินของจริงทุกช่องในตาราง** แล้วพิมพ์ผลออกมา ไม่ใช่สแกนซอร์ส — ตารางที่เขียน
 * จากการอ่านโค้ดจะบอกสิ่งที่โค้ด *ตั้งใจ* ทำ ไม่ใช่สิ่งที่มันทำ
 *
 *   A. บัตรสถานะไหน ทำอะไรได้บ้าง          (สถานะบัตร  × คำสั่ง)
 *   B. โต๊ะสถานะไหน รับบัตรใบใหม่ได้บ้าง    (สถานะโต๊ะ  × รับบัตร)
 *   C. บัตรสถานะไหน บล็อกทางออกของโต๊ะ     (สถานะบัตร  × ทางออกทั้งสามทาง)
 *   D. สิ่งที่ยังไม่มีสถานะ/คำสั่งรองรับ      (ช่องว่างที่ต้องตัดสินใจว่าจะเพิ่มไหม)
 *
 * ชุดสถานะอ่านจาก **CHECK ของฐานจริง** ไม่ใช่ลิสต์ที่เทสพิมพ์เอง — เพิ่มสถานะที่ migration
 * แล้วไม่มาเดินตารางนี้ = แดงทันที (ตารางที่ไม่ครบคือตารางที่อ่านแล้วเชื่อผิด)
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production**
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  cancelBoardGameSession,
  closeBoardGameBillingGroupForBilling,
  closeBoardGameSessionForBilling,
  getBoardGameSession,
  openBoardGameSession,
} from "../apps/web/lib/bms/boardGameCafe.ts";
import {
  listBoardGameIdentityHolds,
  releaseBoardGameIdentityHold,
  revealBoardGameIdentityNumber,
  takeBoardGameIdentityHold,
} from "../apps/web/lib/bms/boardGameIdentity.ts";

const TAG = "bg-identity-matrix";

let tenantId = "";
let locationId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
let rateId = "";
let tableSeq = 0;

let seq = 0;
const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++seq}`;

/** ผลของหนึ่งช่องในตาราง — คำที่ใช้ต้องอ่านแล้วรู้ว่า "ทำได้" ต่างจาก "ทำแล้วไม่เกิดอะไร" */
type Cell = { outcome: "ALLOW" | "NOOP" | "REJECT"; note: string };
const cellText = (cell: Cell) => `${cell.outcome}${cell.note ? ` — ${cell.note}` : ""}`;

async function attempt(label: string, run: () => Promise<Cell>): Promise<Cell> {
  try {
    return await run();
  } catch (error) {
    return { outcome: "REJECT", note: error instanceof Error ? error.message : String(error) };
  }
}

/** ตารางที่จะถูกพิมพ์ท้ายไฟล์ — คือ "คำตอบ" ของไฟล์นี้ */
const matrices: { title: string; columns: string[]; rows: Map<string, Map<string, Cell>> }[] = [];
function matrix(title: string, columns: string[]) {
  const rows = new Map<string, Map<string, Cell>>();
  matrices.push({ title, columns, rows });
  return (row: string, column: string, cell: Cell) => {
    assert.ok(columns.includes(column), `คอลัมน์ "${column}" ไม่ได้ประกาศไว้ในตาราง "${title}"`);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(column, cell);
    return cell;
  };
}

/** ชุดสถานะที่ฐานอนุญาตจริง — ลิสต์ที่เทสพิมพ์เองจะไม่มีวันรู้ว่ามีสถานะใหม่เพิ่มมา */
async function statusesOf(table: string): Promise<string[]> {
  const def = (await query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conrelid = $1::regclass AND c.contype = 'c' AND c.conname = $2`,
    [table, `${table}_status_check`]
  )).rows[0]?.def;
  assert.ok(def, `${table} ต้องมี CHECK ของ status — ไม่มีแปลว่าสถานะไม่ได้ถูกบังคับที่ฐาน`);
  return [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
}

async function newTable(): Promise<string> {
  const code = `T${++tableSeq}`;
  return (await query<{ id: string }>(
    `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
     VALUES ($1,$2,$3,$4,$5,6) RETURNING id`,
    [tenantId, locationId, areaId, `FAKE-${code}`, `FAKE ${TAG} ${code}`]
  )).rows[0].id;
}

async function openTable(minutesAgo = 90, groups = [1]) {
  return openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open"),
      locationId,
      tableId: await newTable(),
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

const sessionStatus = async (sessionId: string) =>
  (await query<{ status: string }>(
    `SELECT status FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sessionId]
  )).rows[0].status;

test("setup: a throwaway board-game cafe", async () => {
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
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes, rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_GENERAL',$2,'GENERAL',60,60,60,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`]
  )).rows[0].id;
});

// =============================================================
// A. บัตรสถานะไหน ทำอะไรได้บ้าง
// =============================================================
test("A. what the counter can do to a card, per card status", async () => {
  const statuses = await statusesOf("bms_board_game_identity_holds");
  const cell = matrix("A. สถานะบัตร × คำสั่ง", [
    "อ่านเลข (reveal)",
    "คืนบัตร (release)",
    "อยู่ในลิสต์ \"ถืออยู่\"",
    "เห็นบนการ์ดโต๊ะ",
  ]);

  for (const status of statuses) {
    // สร้างบัตรให้อยู่ในสถานะนั้นด้วย **เส้นทางจริง** ไม่ใช่ UPDATE ตรง ๆ — สถานะที่ไปถึงด้วย
    // การ UPDATE เท่านั้น คือสถานะที่ระบบจริงไปไม่ถึง และตารางจะโกหก
    const session = await openTable();
    const hold = await take(session.id);
    if (status === "RETURNED") await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
    assert.equal(
      (await listBoardGameIdentityHolds(tenantId, { sessionId: session.id }))[0].status,
      status,
      `ไปถึงสถานะ ${status} ด้วยเส้นทางจริงไม่ได้ — ถ้าไปไม่ได้ สถานะนั้นก็ไม่ควรมีอยู่ใน CHECK`,
    );

    cell(status, "อ่านเลข (reveal)", await attempt("reveal", async () => {
      const revealed = await revealBoardGameIdentityNumber(tenantId, hold.id, staffId, "FAKE matrix");
      return {
        outcome: "ALLOW",
        note: revealed.documentNumber ? "ได้เลขเต็ม" : "ได้ null (เลขถูกล้างไปตอนคืนบัตร)",
      };
    }));

    cell(status, "คืนบัตร (release)", await attempt("release", async () => {
      const released = await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
      return released.replayed
        ? { outcome: "NOOP", note: "คืนไปแล้ว — ตอบใบเดิม ไม่เขียนทับ" }
        : { outcome: "ALLOW", note: "HELD → RETURNED + ล้างชื่อ/เลข/สี่ตัวท้าย" };
    }));

    // สถานะก่อนคืน (ลิสต์/การ์ดโต๊ะ) ต้องอ่านจากบัตรใบที่ยังอยู่ในสถานะนั้น
    const probeSession = await openTable();
    const probe = await take(probeSession.id);
    if (status === "RETURNED") await releaseBoardGameIdentityHold(tenantId, probe.id, {}, staffId);
    const open = await listBoardGameIdentityHolds(tenantId, { sessionId: probeSession.id, openOnly: true });
    cell(status, "อยู่ในลิสต์ \"ถืออยู่\"", {
      outcome: open.length ? "ALLOW" : "REJECT",
      note: open.length ? "ขึ้นในคำถาม \"ตอนนี้ถือบัตรใครอยู่\"" : "ไม่ขึ้น (ถูกกรองออกด้วย openOnly)",
    });
    const detail = await getBoardGameSession(tenantId, probeSession.id);
    const shown = (detail.identityHolds ?? []).find((h) => h.id === probe.id);
    cell(status, "เห็นบนการ์ดโต๊ะ", {
      outcome: shown ? "ALLOW" : "REJECT",
      note: shown ? `tail=${shown.documentNumberTail ?? "—"} hasNumber=${shown.hasDocumentNumber}` : "ไม่อยู่ในคำตอบ",
    });
  }

  // สิ่งที่ตารางนี้พิสูจน์แล้วและต้องไม่เปลี่ยนเงียบ ๆ
  const a = matrices.find((m) => m.title.startsWith("A."))!;
  assert.equal(a.rows.get("HELD")!.get("คืนบัตร (release)")!.outcome, "ALLOW");
  assert.equal(a.rows.get("RETURNED")!.get("คืนบัตร (release)")!.outcome, "NOOP",
    "คืนซ้ำต้องไม่เขียนทับใครเป็นคนยื่นให้");
  assert.equal(a.rows.get("RETURNED")!.get("อ่านเลข (reveal)")!.note, "ได้ null (เลขถูกล้างไปตอนคืนบัตร)",
    "บัตรที่คืนแล้วต้องไม่เหลือเลขให้อ่าน");
  assert.equal(a.rows.get("HELD")!.get("อยู่ในลิสต์ \"ถืออยู่\"")!.outcome, "ALLOW");
  assert.equal(a.rows.get("RETURNED")!.get("อยู่ในลิสต์ \"ถืออยู่\"")!.outcome, "REJECT");
});

// =============================================================
// B. โต๊ะสถานะไหน รับบัตรใบใหม่ได้บ้าง
// =============================================================
test("B. which table states will still accept a new card", async () => {
  const statuses = await statusesOf("bms_board_game_sessions");
  const cell = matrix("B. สถานะโต๊ะ × รับบัตรใบใหม่", ["รับบัตร (take)", "ด่านคืนบัตรจะได้เห็นบัตรใบนี้ไหม"]);

  for (const status of statuses) {
    const session = await openTable();
    if (status === "CLOSING" || status === "PAID") {
      await closeBoardGameSessionForBilling(tenantId, session.id, { idempotencyKey: key("close") }, staffId);
    }
    if (status === "PAID") {
      // ไปถึง PAID จริงต้องผ่านการรับเงินที่เครื่องขาย ซึ่งอยู่นอกขอบเขตไฟล์นี้ — ประทับตรง ๆ
      // แทน เพราะสิ่งที่กำลังวัดคือ "โต๊ะที่จบแล้วรับบัตรใหม่ได้ไหม" ไม่ใช่เส้นทางรับเงิน
      await query(
        `UPDATE bms_board_game_sessions SET status = 'PAID' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, session.id]
      );
    }
    if (status === "CANCELLED") {
      await cancelBoardGameSession(
        tenantId, session.id, { idempotencyKey: key("cancel"), reason: "FAKE matrix" }, staffId
      );
    }
    assert.equal(await sessionStatus(session.id), status);

    const result = await attempt("take", async () => {
      const hold = await take(session.id);
      return { outcome: "ALLOW", note: `บัตร ${hold.id.slice(0, 8)} ถูกผูกกับโต๊ะสถานะ ${status}` };
    });
    cell(status, "รับบัตร (take)", result);

    // ด่าน "คืนบัตรก่อนจบโต๊ะ" อยู่ที่ *ทางออก* ของโต๊ะ · บัตรที่ถูกรับไว้หลังโต๊ะผ่านทางออก
    // ไปแล้ว จะไม่มีด่านไหนได้เห็นมันอีกเลย — นี่คือช่องที่ต้องรู้ว่ามีอยู่
    cell(status, "ด่านคืนบัตรจะได้เห็นบัตรใบนี้ไหม", {
      outcome: result.outcome !== "ALLOW" ? "REJECT" : status === "OPEN" ? "ALLOW" : "NOOP",
      note:
        result.outcome !== "ALLOW"
          ? "ไม่มีบัตรให้เห็น (รับไม่ได้ตั้งแต่แรก)"
          : status === "OPEN"
            ? "ได้ — ทางออกทั้งสามทางยังอยู่ข้างหน้า"
            : "ไม่ได้ — โต๊ะผ่านทางออกไปแล้ว ⚠️",
    });
    if (result.outcome === "ALLOW") {
      const held = await listBoardGameIdentityHolds(tenantId, { sessionId: session.id, openOnly: true });
      for (const hold of held) await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
    }
  }

  const b = matrices.find((m) => m.title.startsWith("B."))!;
  assert.equal(b.rows.get("OPEN")!.get("รับบัตร (take)")!.outcome, "ALLOW");
  assert.equal(b.rows.get("PAID")!.get("รับบัตร (take)")!.outcome, "REJECT",
    "โต๊ะที่จ่ายเงินไปแล้วรับบัตรใหม่ไม่ได้ — จะไม่มีด่านไหนบังคับให้คืน");
  assert.equal(b.rows.get("CANCELLED")!.get("รับบัตร (take)")!.outcome, "REJECT");
});

// =============================================================
// C. บัตรสถานะไหน บล็อกทางออกของโต๊ะ
// =============================================================
test("C. which card status blocks which exit a table has", async () => {
  const cell = matrix("C. สถานะบัตร × ทางออกของโต๊ะ", [
    "ปิดกลุ่มแรก (ยังมีกลุ่มอื่นเล่นอยู่)",
    "ปิดกลุ่มสุดท้าย",
    "ปิดทั้งโต๊ะ",
    "ยกเลิกโต๊ะ",
  ]);

  const exits: [string, (sessionId: string) => Promise<void>][] = [
    ["ปิดทั้งโต๊ะ", async (id) => {
      await closeBoardGameSessionForBilling(tenantId, id, { idempotencyKey: key("close") }, staffId);
    }],
    ["ยกเลิกโต๊ะ", async (id) => {
      await cancelBoardGameSession(tenantId, id, { idempotencyKey: key("cancel"), reason: "FAKE" }, staffId);
    }],
  ];

  for (const status of ["HELD", "RETURNED"]) {
    for (const [label, exit] of exits) {
      const session = await openTable();
      const hold = await take(session.id);
      if (status === "RETURNED") await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
      cell(status, label, await attempt(label, async () => {
        await exit(session.id);
        return { outcome: "ALLOW", note: "โต๊ะจบได้" };
      }));
    }

    // สองกลุ่มบนโต๊ะเดียว — กลุ่มที่จ่ายก่อนแล้วกลับบ้านต้องไม่ถูกบล็อกด้วยบัตรของคนที่ยังเล่นอยู่
    const session = await openTable(90, [1, 2]);
    const hold = await take(session.id);
    if (status === "RETURNED") await releaseBoardGameIdentityHold(tenantId, hold.id, {}, staffId);
    const detail = await getBoardGameSession(tenantId, session.id);
    cell(status, "ปิดกลุ่มแรก (ยังมีกลุ่มอื่นเล่นอยู่)", await attempt("group-1", async () => {
      await closeBoardGameBillingGroupForBilling(
        tenantId, detail.billingGroups[0].id, { idempotencyKey: key("g1") }, staffId
      );
      return { outcome: "ALLOW", note: "กลุ่มที่จ่ายก่อนกลับบ้านได้" };
    }));
    cell(status, "ปิดกลุ่มสุดท้าย", await attempt("group-2", async () => {
      await closeBoardGameBillingGroupForBilling(
        tenantId, detail.billingGroups[1].id, { idempotencyKey: key("g2") }, staffId
      );
      return { outcome: "ALLOW", note: "โต๊ะจบได้" };
    }));
  }

  const c = matrices.find((m) => m.title.startsWith("C."))!;
  for (const exit of ["ปิดกลุ่มสุดท้าย", "ปิดทั้งโต๊ะ", "ยกเลิกโต๊ะ"]) {
    assert.equal(c.rows.get("HELD")!.get(exit)!.outcome, "REJECT", `${exit} ต้องถูกบล็อกขณะยังถือบัตรอยู่`);
    assert.match(c.rows.get("HELD")!.get(exit)!.note, /บัตร/, "ข้อความต้องบอกว่าติดเรื่องบัตร");
    assert.equal(c.rows.get("RETURNED")!.get(exit)!.outcome, "ALLOW", `คืนบัตรแล้ว ${exit} ต้องทำได้`);
  }
  assert.equal(c.rows.get("HELD")!.get("ปิดกลุ่มแรก (ยังมีกลุ่มอื่นเล่นอยู่)")!.outcome, "ALLOW",
    "บัตรต้องบล็อกเฉพาะกลุ่มสุดท้าย ไม่ใช่คนที่จ่ายก่อนแล้วกลับบ้าน");
});

// =============================================================
// D. สิ่งที่ยังไม่มีสถานะ/คำสั่งรองรับ
// =============================================================
test("D. what the card has no state for yet", async () => {
  const holdStatuses = await statusesOf("bms_board_game_identity_holds");
  // ⚠️ ตัวเลขนี้คือสิ่งที่ทำให้ลิสต์ช่องว่างข้างล่างยังจริง — เพิ่มสถานะแล้วต้องมาเดินตาราง A ใหม่
  assert.deepEqual(holdStatuses, ["HELD", "RETURNED"],
    "บัตรมีสองสถานะเท่านั้น — เพิ่มสถานะใหม่ต้องมาเดินตาราง A/C ใหม่ด้วย");

  // เหตุการณ์จริงที่ร้านเจอ แล้ววันนี้บันทึกเป็นสถานะไม่ได้ · เดินของจริงเพื่อพิสูจน์ว่า
  // "ยังไม่รองรับ" ไม่ใช่ "ยังไม่ได้ลอง"
  const session = await openTable();
  const hold = await take(session.id);

  const gaps: { need: string; today: string }[] = [];

  // 1. ร้านทำบัตรของลูกค้าหาย — วันนี้เขียนได้ทางเดียวคือ "คืนแล้ว" ซึ่งเป็นคำโกหก
  const lost = await attempt("LOST", async () => {
    await query(
      `UPDATE bms_board_game_identity_holds SET status = 'LOST' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, hold.id]
    );
    return { outcome: "ALLOW", note: "ฐานยอมรับสถานะนี้" };
  });
  assert.equal(lost.outcome, "REJECT", "CHECK ของฐานต้องกันสถานะที่ไม่ได้ประกาศ");
  gaps.push({
    need: "ร้านทำบัตรหาย / บัตรเสียหาย",
    today: "ไม่มีสถานะ — บันทึกได้ทางเดียวคือ release ซึ่งแปลว่า \"คืนให้ลูกค้าแล้ว\" และล้างเลขทิ้ง",
  });

  // 2. ลูกค้าไม่มารับบัตรคืน — แถวค้าง HELD พร้อมเลขตลอดไป และไม่มีตัวกวาด/รายงาน
  const stale = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_board_game_identity_holds
      WHERE tenant_id = $1 AND status = 'HELD' AND taken_at < now() - interval '30 days'`,
    [tenantId]
  );
  assert.equal(Number(stale.rows[0].n), 0);
  gaps.push({
    need: "บัตรที่ลูกค้าไม่มารับคืน",
    today: "ค้าง HELD พร้อมเลขไปเรื่อย ๆ · ไม่มีสถานะ ไม่มีตัวกวาด ไม่มีรายงาน \"ค้างเกิน N วัน\"",
  });

  // 3. พิมพ์ชื่อ/เลข/ชนิดเอกสารผิด — ไม่มีเส้นทางแก้ไข
  gaps.push({
    need: "พิมพ์ชื่อ/เลข/ชนิดเอกสารผิดตอนรับบัตร",
    today: "ไม่มีคำสั่งแก้ไข · คีย์กันรายการซ้ำทำให้ยิงใหม่ด้วยคีย์เดิมเป็น CONFLICT",
  });

  // 4. รับบัตรผิดใบ/ผิดโต๊ะ — ลบทิ้งไม่ได้ ต้อง release ซึ่งอ่านว่า "คืนแล้ว"
  gaps.push({
    need: "รับบัตรผิดใบหรือผิดโต๊ะ แล้วอยากยกเลิกรายการ",
    today: "ไม่มีสถานะ VOID/ยกเลิก — ทางเดียวคือ release ซึ่งไปปนกับบัตรที่คืนจริง",
  });

  // 5. บัตรที่รับไว้ตอนโต๊ะอยู่สถานะ CLOSING ไม่มีด่านไหนได้เห็นอีก (ตาราง B พิสูจน์ไว้แล้ว)
  const b = matrices.find((m) => m.title.startsWith("B."));
  if (b?.rows.get("CLOSING")?.get("รับบัตร (take)")?.outcome === "ALLOW") {
    gaps.push({
      need: "บัตรที่รับไว้หลังโต๊ะถูกกดปิดเวลาแล้ว (สถานะ CLOSING)",
      today:
        "service ยอมรับ (SQL เขียน status IN ('OPEN','CLOSING')) แต่ทางออกทั้งสามทางผ่านไปแล้ว "
        + "— ไม่มีด่านไหนได้เห็นบัตรใบนี้อีก ⚠️ · จอทั้งสองฝั่งซ่อนฟอร์มรับบัตรไว้ที่ "
        + "status === 'OPEN' อยู่แล้ว ช่องนี้จึงเข้าถึงได้ทาง API เท่านั้น (จอคือ UX ด่านคือ server)",
    });
  }

  // 6. ไม่มีเพดานจำนวนบัตรต่อโต๊ะ — บันทึกไว้ให้เห็นว่าเป็นสิ่งที่จงใจหรือยังไม่ได้ตัดสิน
  const second = await take(session.id, { holderName: "FAKE second guest" });
  assert.ok(second.id !== hold.id, "รับบัตรใบที่สองของโต๊ะเดียวกันได้");
  gaps.push({
    need: "เพดานจำนวนบัตรต่อโต๊ะ",
    today: "ไม่มี — รับได้ไม่จำกัด (ถูกสำหรับกลุ่มที่ยืมหลายกล่อง แต่ยังไม่มีอะไรจับการรับซ้ำโดยพลาด)",
  });

  console.log(`\n${"=".repeat(78)}\nD. สิ่งที่ยังไม่มีสถานะ/คำสั่งรองรับ (ช่องว่างที่ต้องตัดสินใจ)\n${"=".repeat(78)}`);
  gaps.forEach((gap, index) => {
    console.log(`${index + 1}. ต้องการ : ${gap.need}`);
    console.log(`   วันนี้   : ${gap.today}\n`);
  });

  for (const held of await listBoardGameIdentityHolds(tenantId, { sessionId: session.id, openOnly: true })) {
    await releaseBoardGameIdentityHold(tenantId, held.id, {}, staffId);
  }
  assert.ok(gaps.length >= 5, "ลิสต์ช่องว่างหายไป — ไฟล์นี้มีไว้ตอบว่าต้องเพิ่มอะไร");
});

test("the supported-state matrix, printed", () => {
  for (const { title, columns, rows } of matrices) {
    console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
    for (const [row, cells] of rows) {
      console.log(`\n  ${row}`);
      for (const column of columns) {
        const cell = cells.get(column);
        console.log(`    ${column.padEnd(34, " ")} ${cell ? cellText(cell) : "— ไม่ได้เดิน"}`);
      }
    }
  }
  console.log("");
  assert.ok(matrices.length === 3, "ต้องมีครบสามตาราง ไม่งั้นบทสรุปที่พิมพ์ออกมาไม่ครบ");
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
