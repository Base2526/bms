// =============================================================
// ด่านตรวจ "ลิสต์ readiness ครอบของที่โค้ดต้องมีจริงหรือยัง"
// -------------------------------------------------------------
// `schema-readiness-contract` ตรวจว่าไฟล์ .sql ตรงกับลิสต์ — แต่ตรวจไม่ได้ว่า **ลิสต์เอง
// ครบไหม** ลิสต์ที่ขาดไฟล์คือตัวตรวจที่ตอบว่า "ฐานพร้อม" แล้ว deploy ไปขายไม่ได้สักบิล
// (เกิดจริง: `9.82` เพิ่ม `bms_orders.board_game_session_id` และ `9.87` เพิ่ม
// `restaurant_service_mode` · ทั้งคู่ถูก INSERT ในบิลของทุกช่องทางของทุกร้าน แต่ไม่มีชื่อ
// อยู่ในลิสต์เลย)
//
// ไฟล์นี้เดินกลับทาง: ไล่จาก **คอลัมน์ที่ `createOrderInTx()` เขียนจริง** แล้วบังคับว่า
// ตัวที่มาจาก migration ในช่วงที่ลิสต์ประกาศว่าตัวเองครอบ ต้องถูกประกาศไว้
//
//   cd apps/web && npx tsx --test ../../scripts/schema-readiness-coverage-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { MIGRATIONS } from "./schemaReadiness.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = path.join(ROOT, "db", "migrations");
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8");

/** `9.7` ต้องมาก่อน `9.40` — เรียงด้วยตัวเลข ไม่ใช่ตัวอักษร (กับดักเดิมของรีโปนี้) */
function version(file: string): [number, number] {
  const match = /^(\d+)\.(\d+)__/.exec(file);
  if (!match) throw new Error(`migration name ไม่ตรงรูปแบบ: ${file}`);
  return [Number(match[1]), Number(match[2])];
}
const isAtLeast = (a: [number, number], b: [number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1];

const migrationFiles = readdirSync(MIGRATION_DIR).filter((file) => /^\d+\.\d+__/.test(file));

test("ทุกไฟล์ที่ลิสต์อ้างถึงต้องมีอยู่จริง", () => {
  for (const migration of MIGRATIONS) {
    assert.ok(
      migrationFiles.includes(migration.file),
      `${migration.file} อยู่ในลิสต์แต่ไม่มีไฟล์ใน db/migrations`
    );
  }
});

test("ของที่ลิสต์บอกให้ตรวจ ต้องถูกสร้างโดยไฟล์นั้นจริง ไม่ใช่ชื่อที่พิมพ์ลอย ๆ", () => {
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(path.join(MIGRATION_DIR, migration.file), "utf8");
    for (const need of migration.needs) {
      if (need.kind === "table") {
        assert.match(
          sql,
          new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+(?:public\\.)?${need.name}\\b`, "i"),
          `${migration.file} ไม่ได้สร้างตาราง ${need.name}`
        );
      } else {
        // ผูกคอลัมน์กับตารางของมันเสมอ — ไฟล์เดียวแก้ได้หลายตาราง ถ้าเจอคำว่า ADD COLUMN
        // ลอย ๆ ที่ไหนก็ได้ในไฟล์ ด่านนี้จะยืนยันได้แค่ "มีคำนี้อยู่" ไม่ใช่ "เพิ่มให้ตารางนี้"
        const alterBlocks = sql.match(new RegExp(
          `ALTER TABLE(?:\\s+IF EXISTS)?\\s+(?:public\\.)?${need.table}\\b[\\s\\S]*?;`,
          "gi",
        )) ?? [];
        const addsColumn = alterBlocks.some((block) =>
          new RegExp(`ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+${need.name}\\b`, "i").test(block));
        const createsTable = new RegExp(
          `CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+(?:public\\.)?${need.table}\\b[\\s\\S]*?\\b${need.name}\\b`,
          "i"
        );
        assert.ok(
          addsColumn || createsTable.test(sql),
          `${migration.file} ไม่ได้เพิ่มคอลัมน์ ${need.table}.${need.name}`
        );
      }
    }
  }
});

test("คอลัมน์ที่ createOrderInTx เขียนทุกบิล ต้องอยู่ในลิสต์ถ้ามาจาก migration ในช่วงที่ลิสต์ครอบ", () => {
  // ลิสต์ประกาศตัวเองว่า "ครอบเฉพาะไฟล์ที่โค้ดปัจจุบันอ้างถึงแบบไม่มีเงื่อนไข" และของเก่ากว่านั้น
  // ถ้าขาดจะพังตั้งแต่หน้าแรกจนเห็นเอง · เส้นแบ่งจึงเป็น "ไฟล์เก่าสุดที่ลิสต์ครอบอยู่" ซึ่งอ่านจาก
  // ลิสต์เอง ไม่ใช่เลขที่ฝังไว้ — เพิ่มของเก่ากว่านี้เข้าลิสต์เมื่อไร ด่านนี้ก็ขยับตามเอง
  const baseline = MIGRATIONS.map((migration) => version(migration.file))
    .reduce((lowest, current) => (isAtLeast(current, lowest) ? lowest : current));

  const orders = read("apps", "web", "lib", "bms", "orders.ts");
  const insert = /INSERT INTO bms_orders \(([\s\S]*?)\)\s*\r?\n?\s*VALUES/.exec(orders);
  assert.ok(insert, "หา INSERT INTO bms_orders ใน orders.ts ไม่เจอ — ด่านนี้ต้องเล็งใหม่ ไม่ใช่ลบทิ้ง");
  const inserted = insert![1].split(",").map((column) => column.trim()).filter(Boolean);
  assert.ok(inserted.length > 15, `อ่านคอลัมน์ได้แค่ ${inserted.length} ตัว — regex น่าจะตัดผิด`);

  // คอลัมน์ไหนมาจากไฟล์ไหน (ตัวแรกที่เพิ่มชนะ)
  const addedBy = new Map<string, string>();
  for (const file of [...migrationFiles].sort((a, b) => {
    const [am, an] = version(a); const [bm, bn] = version(b);
    return am - bm || an - bn;
  })) {
    const sql = readFileSync(path.join(MIGRATION_DIR, file), "utf8");
    const alters = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?bms_orders\b([\s\S]*?);/gi;
    let alter: RegExpExecArray | null;
    while ((alter = alters.exec(sql))) {
      const columns = /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
      let column: RegExpExecArray | null;
      while ((column = columns.exec(alter[1]))) {
        if (!addedBy.has(column[1])) addedBy.set(column[1], file);
      }
    }
  }

  const declared = new Set(
    MIGRATIONS.flatMap((migration) => migration.needs)
      .filter((need): need is { kind: "column"; table: string; name: string } =>
        need.kind === "column" && need.table === "bms_orders")
      .map((need) => need.name)
  );

  const missing = inserted
    .filter((column) => addedBy.has(column))
    .filter((column) => isAtLeast(version(addedBy.get(column)!), baseline))
    .filter((column) => !declared.has(column));

  assert.deepEqual(
    missing,
    [],
    `คอลัมน์นี้ถูก INSERT ทุกบิลแต่ไม่มีใน schemaReadiness — ฐานที่ยังไม่ apply จะ "ผ่าน readiness" `
    + `แล้วขายไม่ได้ทั้งระบบ: ${missing.map((column) => `${column} (${addedBy.get(column)})`).join(", ")}`
  );
});
