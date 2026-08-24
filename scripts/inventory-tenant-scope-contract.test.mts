// =============================================================
// Nothing touches bms_inventory without naming the shop
// -------------------------------------------------------------
// `bms_inventory` is keyed by (tenant_id, location_id, product_sku, size), so a
// statement that filters on sku + size alone matches that product in EVERY shop
// and EVERY branch that stocks it. There is no error, no constraint violation,
// and nothing in the response to reveal it — the writer sees success while
// another shop's shelf changes.
//
// That is not hypothetical: reserveStock() shipped that way, and the dev database
// has `NIKE-AIR/XL` in two different tenants, so one call moved both. It was the
// only such statement in the codebase (16 writes, 1 unscoped), which is exactly
// why a test is worth having — the other 15 are correct, so the next unscoped one
// will look just as ordinary in review as this one did.
//
// RLS is not a substitute. Read paths use query() without SET LOCAL ROLE, so the
// policies do not apply, and a superuser connection bypasses them anyway
// (CLAUDE.local.md § ก่อน production still lists "make the app connect as a
// non-superuser" as open work).
//
// No database. Run from apps/web:
//   npx tsx --test ../../scripts/inventory-tenant-scope-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "../apps/web");

/** ตารางที่ผูกกับร้าน และการลืม tenant_id คือการแตะข้อมูลร้านอื่นเงียบ ๆ */
const TENANT_SCOPED_TABLES = ["bms_inventory", "bms_product_price_tiers", "bms_product_packs"];

/**
 * ไฟล์ที่รันฝั่ง server เท่านั้น — devSeed/สคริปต์ seeder ก็ต้องผูก tenant เหมือนกัน
 * (AGENTS.md: seeder ที่ลืม tenant_id สร้างแถวที่ไม่โผล่ในหน้า admin)
 */
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

/**
 * ตัด statement ออกมาจาก template literal ที่ล้อมอยู่ — โค้ดเบสนี้เขียน SQL ใน
 * backtick ทั้งหมด ถ้าเจอ match ที่ไม่ได้อยู่ใน backtick แปลว่ารูปแบบเปลี่ยนแล้ว
 * และเทสนี้เชื่อไม่ได้อีก จึงต้องฟ้อง ไม่ใช่ปล่อยผ่าน
 */
const enclosingSql = (src: string, at: number) => {
  const open = src.lastIndexOf("`", at);
  const close = src.indexOf("`", at);
  if (open === -1 || close === -1) return null;
  return src.slice(open + 1, close);
};

/**
 * คอมเมนต์ที่อธิบายบั๊กมักอ้างชื่อตารางใน `backtick` ซึ่งหน้าตาเหมือน SQL literal
 * — เทสที่นับคอมเมนต์เป็น statement จะแดงใส่คำอธิบายของตัวเอง
 */
const isInComment = (src: string, at: number) => {
  const lineStart = src.lastIndexOf("\n", at) + 1;
  const before = src.slice(lineStart, at);
  const trimmed = before.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
};

test("every SQL statement touching a tenant-scoped stock table filters by tenant_id", () => {
  const files = walk(path.join(WEB, "lib")).concat(walk(path.join(WEB, "app")));
  assert.ok(files.length > 100, `เจอไฟล์แค่ ${files.length} — การเดิน tree คงพลาด`);

  const unscoped: string[] = [];
  const unparsed: string[] = [];
  let statements = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const table of TENANT_SCOPED_TABLES) {
      const re = new RegExp(`\\b(?:FROM|UPDATE|INTO|JOIN)\\s+${table}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (isInComment(src, m.index)) continue;
        const sql = enclosingSql(src, m.index);
        const where = `${path.relative(WEB, file)}:${src.slice(0, m.index).split("\n").length}`;
        if (sql == null) {
          unparsed.push(where);
          continue;
        }
        statements++;
        if (!/tenant_id/i.test(sql)) unscoped.push(`${where} (${table})`);
      }
    }
  }

  assert.deepEqual(unparsed, [], "SQL ที่ไม่ได้อยู่ใน template literal — เทสนี้อ่านไม่ออก ต้องมาดูด้วยมือ");
  assert.ok(statements > 20, `ตรวจไปแค่ ${statements} statement — regex คงพัง`);
  assert.deepEqual(
    unscoped.sort(),
    [],
    "statement เหล่านี้จะแตะสต็อกของทุกร้านที่ขาย SKU เดียวกัน โดยไม่มี error ให้เห็น"
  );
});

test("the reserve route never takes its tenant from the request body", () => {
  const route = readFileSync(path.join(WEB, "app/api/bms/reserve/route.ts"), "utf8");
  assert.match(route, /authorizeAdminRoute\(/, "route ที่เขียนสต็อกต้องยืนยันตัวตนก่อน");
  assert.match(route, /tenantId:\s*auth\.tenantId/, "tenant ต้องมาจาก session ที่เซ็นไว้");
  assert.equal(
    /body\.tenantId|tenantId\s*=\s*(?:String\()?body/.test(route),
    false,
    "รับ tenant จาก body = กลับไปเป็นช่องที่ระบุร้านปลายทางเองได้ แม้จะล็อกอินแล้ว"
  );
});
