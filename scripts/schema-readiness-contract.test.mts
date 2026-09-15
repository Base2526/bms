// =============================================================
// ไฟล์ SQL ที่ generate ไว้ต้องตรงกับลิสต์ตัวจริงเสมอ
// -------------------------------------------------------------
// `db/checks/schema-readiness.sql` มีไว้ให้เซิร์ฟเวอร์ที่ไม่มี Node รันด้วย psql ตรง ๆ
// (production ตอบ `npx: command not found` — 2026-09-05) · ไฟล์ที่ generate แล้วปล่อยให้
// เก่ากว่าลิสต์จริงคือ "ตัวตรวจที่โกหก" ซึ่งแย่กว่าไม่มีตัวตรวจ เพราะคนเชื่อคำว่า "ครบ"
//
//   cd apps/web && npx tsx --test ../../scripts/schema-readiness-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MIGRATIONS, renderReadinessSql } from "./schemaReadiness.mts";

const file = new URL("../db/checks/schema-readiness.sql", import.meta.url);

// เทียบแบบไม่สนชนิดของขึ้นบรรทัดใหม่ — repo เก็บไฟล์เป็น LF แต่ autocrlf บน Windows
// เช็คเอาต์เป็น CRLF ส่วนตัวเรนเดอร์คืน LF เสมอ · เทียบดิบ ๆ แล้วเทสนี้จะแดงทุกครั้ง
// บนเครื่อง Windows ทั้งที่ไฟล์ถูกต้อง และเทสที่แดงเสมอคือเทสที่เลิกมีคนอ่าน
const sameLines = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd();

test("ไฟล์ SQL ที่ commit ไว้ต้องตรงกับตัวเรนเดอร์ (regenerate ด้วย --sql)", async () => {
  assert.equal(
    sameLines(await readFile(file, "utf8")),
    sameLines(renderReadinessSql()),
    "รัน: npx tsx scripts/check-schema-readiness.mts --sql > db/checks/schema-readiness.sql"
  );
});

test("ทุกไฟล์ในลิสต์ต้องมีของให้ตรวจ และบอกผลถ้าไม่รัน", async () => {
  assert.ok(MIGRATIONS.length >= 10);
  for (const migration of MIGRATIONS) {
    assert.match(migration.file, /^\d+\.\d+__[a-z0-9_]+\.sql$/, migration.file);
    assert.ok(migration.needs.length > 0, `${migration.file} ไม่มีของให้ตรวจ`);
    // "ผลถ้าไม่รัน" ต้องเป็นอาการที่คนอ่านแล้วตัดสินใจได้ ไม่ใช่ชื่อ error
    assert.ok(migration.impact.length > 10, `${migration.file} ไม่ได้บอกว่าพังยังไง`);
  }
});

test("SQL ที่ generate ต้องครอบทุกอย่างในลิสต์ และไม่ต่อฐานเอง", async () => {
  const sql = renderReadinessSql();
  for (const migration of MIGRATIONS) {
    assert.ok(sql.includes(`'${migration.file}'`), `${migration.file} หายจาก SQL`);
    for (const need of migration.needs) {
      assert.ok(sql.includes(`'${need.kind === "table" ? need.name : need.table}'`));
    }
  }
  assert.match(sql, /to_regclass\('public\.' \|\| r\.tbl\)/);
  assert.match(sql, /information_schema\.columns/);
});

/**
 * ตารางที่ service อ่าน "ก่อนแตะสต็อก โดยไม่มีธงและไม่ได้ห่อ try/catch" ต้องอยู่ในลิสต์เสมอ
 *
 * `replayInventoryResult()` ยิง SELECT ตัวนี้เป็นคำสั่งแรกของทุก mutation โอน/นับสต็อกที่มา
 * จากเครื่องขาย native (SDL บังคับ `idempotencyKey: String!`) ฐานที่ยังไม่ apply `9.88` จึงได้
 * 42P01 แล้ว rollback ทั้งก้อน — ไล่หาไม่เจอเลยถ้าตัวตรวจ readiness ไม่รู้จักไฟล์นี้
 *
 * ด่านนี้เดินจาก **ซอร์สจริง** ไปหาลิสต์ ไม่ใช่จากชื่อที่เทสพิมพ์เอง
 */
test("ตารางที่โมดูล idempotency อ่านทุกครั้ง ต้องถูกคุมด้วย readiness", () => {
  const source = readFileSync(
    new URL("../apps/web/lib/bms/inventoryIdempotency.ts", import.meta.url),
    "utf8",
  );
  const tables = [...source.matchAll(/(?:FROM|INSERT INTO)\s+([a-z_][a-z0-9_]*)/g)]
    .map((match) => match[1]);
  assert.ok(tables.length > 0, "ต้องอ่านชื่อตารางจากซอร์สได้จริง");
  const covered = new Set(
    MIGRATIONS.flatMap((migration) =>
      migration.needs.map((need) => (need.kind === "table" ? need.name : need.table)),
    ),
  );
  assert.deepEqual(
    [...new Set(tables)].filter((table) => !covered.has(table)),
    [],
    "เพิ่มไฟล์ migration ของตารางนี้เข้า MIGRATIONS แล้ว regenerate db/checks/schema-readiness.sql",
  );
});
