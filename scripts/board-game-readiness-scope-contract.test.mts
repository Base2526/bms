/**
 * ด่านที่กัน "ตัวตรวจก่อน deploy ที่โกหก" และ "กฎที่ประกาศไว้แต่ไม่มีอะไรบังคับ" ของโมดูลบอร์ดเกม
 *
 * ทั้งสองอย่างนี้เขียวได้ตลอดถ้าไม่มีใครเล็ง เพราะมันไม่ทำให้อะไรพังตอนคอมไพล์:
 *
 *  - `db/checks/schema-readiness.sql` เป็นเครื่องมือเดียวที่รันบนเซิร์ฟเวอร์ production ได้
 *    (ที่นั่นไม่มี Node) · ไฟล์ migration ที่ขาดจากลิสต์ทำให้มันตอบว่า "พร้อม" กับฐานที่ apply
 *    ไม่ครบ ซึ่ง CLAUDE.md เรียกว่า "แย่กว่าไม่มีตัวตรวจเลย"
 *  - `bms_board_game_pass_plans.location_id` ประกาศไว้ที่คอลัมน์เองว่า "มีค่า = แพ็กเกจของ
 *    สาขานั้นสาขาเดียว" · คอลัมน์ที่ประกาศกฎแล้วไม่มีใครบังคับแย่กว่าไม่มีคอลัมน์ เพราะคนอ่าน
 *    เชื่อว่ามีการกันอยู่
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { MIGRATIONS } from "../apps/web/../../scripts/schemaReadiness.mts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}
const has = (source: string, re: RegExp, message: string) =>
  assert.ok(re.test(source), message);

const cafe = withoutComments(read("apps/web/lib/bms/boardGameCafe.ts"));
const passRoute = withoutComments(read("apps/web/app/api/bms/board-game/passes/route.ts"));

/**
 * ⚠️ มีกับดักสองชั้นซ้อนกัน และเทสที่ติดกับดักจะ **เขียวโดยไม่เคยเห็นโค้ดที่กำลังตรึงอยู่เลย**
 *
 * 1. `{` ตัวแรกหลังชื่อฟังก์ชันคือ type ของพารามิเตอร์ ไม่ใช่ตัวฟังก์ชัน (จดไว้ใน CLAUDE.local.md)
 * 2. ข้ามพารามิเตอร์แล้วก็ยังไม่พอ — `Promise<X & { replayed: boolean }>` ทำให้ `{` ตัวถัดไป
 *    เป็นของ **return type** · ตัวฟังก์ชันคือ `{` ตัวแรกที่อยู่นอกวงเล็บมุมทั้งหมด
 */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`function ${name}`);
  assert.ok(at >= 0, `${name} must exist`);
  let cursor = source.indexOf("(", at);
  let depth = 0;
  for (let i = cursor; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) { cursor = i + 1; break; }
    }
  }
  let angle = 0;
  let open = -1;
  for (let i = cursor; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "<") angle += 1;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "{" && angle === 0) { open = i; break; }
  }
  assert.ok(open > 0, `${name}: body not found — the extractor is reading a type, not code`);
  depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(open, i);
        // ตัวฟังก์ชันจริงยาวกว่านี้เสมอ — สั้นกว่านี้แปลว่ายังอ่าน type อยู่
        assert.ok(body.length > 120, `${name}: extracted ${body.length} chars — that is a type, not the body`);
        return body;
      }
    }
  }
  return source.slice(open);
}

/**
 * ไฟล์ migration ที่ **สร้าง** ตารางนั้น — ใช้ตัดสินว่าตารางอยู่ในช่วงที่ลิสต์ครอบหรือยัง
 * · เส้นแบ่งอ่านจากลิสต์เอง ไม่ได้ฝังเลขไว้ในเทส (รูปเดียวกับ schema-readiness-coverage-contract)
 */
function creatingMigration(table: string): number | null {
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(new URL(file, dir), "utf8");
    if (new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table}\\b`).test(sql)) {
      const version = /^(\d+)\.(\d+)__/.exec(file);
      return version ? Number(version[1]) * 1000 + Number(version[2]) : null;
    }
  }
  return null;
}

test("a board-game table cannot be opened or closed against a database the check calls ready", () => {
  // เดินจาก **ซอร์สจริง** ไปหาลิสต์ ไม่ใช่จากชื่อไฟล์ที่เทสพิมพ์เอง — ลิสต์ที่เทสถือเองจะไม่มีวัน
  // รู้ว่ามี migration ใหม่เพิ่มเข้ามา ซึ่งเป็นรูปของความล้มเหลวที่เงียบที่สุด
  const declaredTables = new Set(
    MIGRATIONS.flatMap((migration) =>
      migration.needs.map((need) => (need.kind === "table" ? need.name : need.table))),
  );

  // ตารางที่เส้นทางหลักของโต๊ะแตะแบบไม่มีเงื่อนไข: เปิด · อ่าน · ปิดกลุ่ม · ปิดโต๊ะ · ยกเลิก
  const criticalPaths: Array<[string, string]> = [
    ["openBoardGameSession", "เปิดโต๊ะ"],
    ["getBoardGameSession", "เปิดดูโต๊ะ"],
    ["closeBoardGameBillingGroupForBilling", "ปิดบิลทีละกลุ่ม"],
    ["closeBoardGameSessionForBilling", "ปิดทั้งโต๊ะ"],
    ["cancelBoardGameSession", "ยกเลิกโต๊ะ"],
  ];
  const touched = new Set<string>();
  for (const [fn] of criticalPaths) {
    for (const match of functionBody(cafe, fn).matchAll(/\b(bms_board_game_[a-z_]+)\b/g)) {
      touched.add(match[1]);
    }
  }
  // ปิดกลุ่มเรียก closeOpenBillingGroupInTx ต่อ ซึ่งล็อกและอ่านแพ็กเกจก่อนคิดยอดเสมอ
  for (const match of functionBody(cafe, "closeOpenBillingGroupInTx").matchAll(/\b(bms_board_game_[a-z_]+)\b/g)) {
    touched.add(match[1]);
  }
  for (const match of functionBody(cafe, "activePassesForGroupInTx").matchAll(/\b(bms_board_game_[a-z_]+)\b/g)) {
    touched.add(match[1]);
  }

  // ของที่เก่ากว่าช่วงที่ลิสต์ครอบไม่นับ — ฐานที่ขาด `9.79`-`9.83` ไม่มีโมดูลบอร์ดเกมเลย
  // ซึ่งเห็นเองตั้งแต่หน้าแรก · เคสที่เงียบคือฐานที่ดูเหมือนติดตั้งครบแล้วเปิดโต๊ะไม่ได้
  const covered = Math.min(...MIGRATIONS
    .map((migration) => /^(\d+)\.(\d+)__/.exec(migration.file))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]) * 1000 + Number(match[2])));
  const missing = [...touched]
    .filter((table) => {
      const created = creatingMigration(table);
      return created != null && created >= covered && !declaredTables.has(table);
    })
    .sort();
  assert.deepEqual(
    missing,
    [],
    "ตารางที่เส้นทางเปิด/อ่าน/ปิด/ยกเลิกโต๊ะแตะทุกครั้ง ต้องอยู่ใน schemaReadiness — "
      + "ไม่งั้นตัวตรวจบนเซิร์ฟเวอร์จะตอบว่าพร้อมแล้วร้านเปิดโต๊ะไม่ได้สักโต๊ะ",
  );
  assert.ok(touched.size >= 5, "ตัวสแกนต้องเห็นตารางจริง ไม่ใช่เขียวเพราะหาอะไรไม่เจอ");
});

test("the generated readiness SQL still carries every board-game migration", () => {
  const sql = read("db/checks/schema-readiness.sql");
  for (const file of ["9.89", "9.90", "9.91", "9.92", "9.93", "9.94"]) {
    has(sql, new RegExp(`'${file.replace(".", "\\.")}__`), `${file} หายจากไฟล์ที่ generate ไว้`);
  }
});

test("a branch-scoped pass is a rule the server keeps, not a column nobody checks", () => {
  // ด่านต้องอยู่ที่ service ด้วย ไม่ใช่เฉพาะที่ route — ผู้เรียกที่ไม่ผ่าน route (เทส งานภายใน
  // เส้นทางใหม่) จะขายข้ามสาขาได้เงียบ ๆ ถ้าด่านอยู่ข้างนอกอย่างเดียว
  const issue = functionBody(cafe, "issueBoardGameMemberPass");
  has(issue, /location_id/, "การขายต้องอ่านสาขาของแพ็กเกจออกมาก่อน");
  has(
    issue,
    /planLocationId\s*&&\s*locationId\s*!==\s*planLocationId[\s\S]{0,120}throw new Error/,
    "แพ็กเกจที่ผูกสาขาไว้ต้องปฏิเสธทั้งสาขาผิดและผู้เรียกที่ไม่ส่งสาขา",
  );
  has(issue, /orderId[\s\S]{0,300}FROM bms_orders[\s\S]{0,160}tenant_id = \$1/,
    "บิลที่ผูกกับแพ็กเกจต้องถูกตรวจว่าเป็นของร้านเดียวกัน");
  has(issue, /INSERT INTO bms_board_game_member_passes[\s\S]{0,180}location_id/,
    "สิทธิ์ที่ขายแล้วต้อง snapshot สาขาไว้ ไม่ตามแคตตาล็อกที่แก้ภายหลัง");

  // และ route ต้องกันไว้ก่อนถึง service ทั้งสามคำสั่ง
  // ⚠️ ขอบของบล็อกต้องเป็น "คำสั่งถัดไป" ไม่ใช่จำนวนตัวอักษรคงที่ — หน้าต่างที่กว้างเกินจะไป
  // เห็นด่านของคำสั่งข้าง ๆ แล้วรายงานว่ากันไว้แล้วทั้งที่คำสั่งนี้ไม่มีด่านเลย
  const actions = [...passRoute.matchAll(/action === "(\w+)"/g)];
  assert.equal(actions.length, 3, "route ต้องมีสามคำสั่ง: plan, issue, cancel");
  for (const [index, match] of actions.entries()) {
    const action = match[1];
    const start = match.index ?? 0;
    const end = index + 1 < actions.length ? (actions[index + 1].index ?? passRoute.length) : passRoute.length;
    const block = passRoute.slice(start, end);
    assert.ok(
      /canAccessBoardGameLocation|allowedOnPlan/.test(block),
      `คำสั่ง "${action}" ต้องมีด่านสาขาของตัวเอง ไม่ใช่ยืมของคำสั่งข้าง ๆ`,
    );
  }
  // แคตตาล็อกที่ส่งให้จอต้องถูกกรองตามสาขาที่บัญชีนี้ดูแล ไม่งั้นจอยื่นตัวเลือกที่กดแล้วโดน 403
  has(passRoute, /listLocationsForUser/, "GET ต้องกรองแคตตาล็อกตามสาขาที่ผู้เรียกดูแล");
  has(passRoute, /listBoardGamePassPlans\(auth\.tenantId, visible\)/, "และต้องส่งลิสต์นั้นเข้าไปจริง");
  has(passRoute, /visibleLocationIds: visible/, "รายการสิทธิ์สมาชิกต้องถูกกรองด้วยสาขาเดียวกัน");
  has(passRoute, /boardGamePassOutstanding\(auth\.tenantId, visible\)/,
    "ยอดรวมต้องไม่เปิดเผยตัวเลขของสาขาที่ผู้เรียกดูแลไม่ได้");
  // แพ็กเกจระดับร้าน (NULL) ต้องไม่หายไปจากตัวกรอง
  has(
    functionBody(cafe, "listBoardGamePassPlans"),
    /location_id IS NULL OR location_id = ANY/,
    "แพ็กเกจระดับร้านต้องเห็นได้ทุกคนตามนิยามของมันเอง",
  );
  has(
    functionBody(cafe, "activePassesForGroupInTx"),
    /pass\.location_id IS NULL[\s\S]{0,220}bill\.location_id/,
    "สิทธิ์ผูกสาขาต้องช่วยจ่ายได้เฉพาะกลุ่มบิลในสาขานั้น",
  );
});

test("the cached minute balance is checkable against the ledger, like points and store credit", () => {
  // `9.92` เขียนกฎนี้ไว้ที่ migration เอง แต่กฎที่ไม่มีใครวัดได้คือกฎที่เพี้ยนเงียบ ๆ
  const report = functionBody(cafe, "boardGamePassOutstanding");
  has(report, /bms_board_game_pass_ledger/, "ต้องเทียบกับ ledger จริง ไม่ใช่เชื่อยอดที่แคชไว้");
  has(report, /mismatch/, "ต้องรายงานจำนวนใบที่ยอดไม่ตรง");
  // ไม่อั้นไม่มียอดให้เทียบ — นับเข้า drift เมื่อไรจะแดงตลอดเวลาแล้วเลิกมีคนอ่าน
  has(report, /remaining_minutes IS NOT NULL/, "แพ็กเกจไม่อั้นต้องไม่ถูกนับเป็น drift");
  // ...และต้องมีใครสักคนเรียกมัน ไม่งั้นเป็นรายงานที่ไม่มีใครเห็น
  has(passRoute, /boardGamePassOutstanding\(/, "route ต้องส่งยอดคงค้างออกไปให้จอ");
  has(
    withoutComments(read("apps/web/app/(admin)/admin/board-game/page.tsx")),
    /balanceMismatchCount/,
    "จอต้องแสดงตัวเลขนั้น",
  );
});
