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
import test from "node:test";

import { MIGRATIONS, renderReadinessSql } from "./schemaReadiness.mts";

const file = new URL("../db/checks/schema-readiness.sql", import.meta.url);

test("ไฟล์ SQL ที่ commit ไว้ต้องตรงกับตัวเรนเดอร์ (regenerate ด้วย --sql)", async () => {
  assert.equal(
    (await readFile(file, "utf8")).trimEnd(),
    renderReadinessSql().trimEnd(),
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
