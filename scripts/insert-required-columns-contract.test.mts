// =============================================================
// ทุก INSERT ต้องให้ค่าคอลัมน์ที่ฐานบังคับว่าห้ามว่าง
// -------------------------------------------------------------
// `sql-table-reference-contract` กัน "ชื่อตารางที่ไม่มีอยู่จริง" ไปแล้ว ไฟล์นี้คือชั้นถัดไป
// ของกับดักเดียวกัน: **ชื่อตารางถูก แต่ลิสต์คอลัมน์ขาดตัวที่ NOT NULL**
//
// เกิดจริง: `9.22` เพิ่ม `bms_order_items.receipt_unit_price` เป็น NOT NULL (ไม่มี default)
// และแก้ `createOrderInTx()` ให้เขียนค่านั้น แต่ตัว seeder (`devSeed.ts`) เขียน
// `bms_order_items` เองอีกทาง แล้วไม่มีใครไปเติมคอลัมน์ให้ ผลคือ
//   - ปุ่ม "สร้างร้านทดสอบ" ล้มทุกครั้งแล้วลบร้านที่เพิ่งสร้างทิ้ง
//   - ปุ่ม "สร้างข้อมูลตัวอย่าง" ของร้านจริงที่เพิ่งสมัคร ค้างที่ขั้น orders ตลอดไป
//     (ขั้นก่อนหน้าถูกบันทึกว่าสำเร็จแล้ว รอบถัดไปจึงมาตายที่เดิม)
//
// SQL อยู่ใน template literal ทั้งหมด tsc/production build/เทสที่ไม่ได้ยิงคำสั่งจริง
// จึงมองไม่เห็น — เห็นเป็น 23502 ครั้งแรกที่มีคนเดินเส้นนั้นด้วยมือเท่านั้น
//
// คอลัมน์ที่ "ต้องมี" อ่านจาก db/migrations ไม่ใช่จากฐานที่รันอยู่ ด่านนี้จึงทำงานใน CI ที่
// ไม่มี Postgres ได้ · ที่ยอมรับไว้: คอลัมน์ที่ถูกเพิ่มด้วย `DO $$ ... EXECUTE format()`
// (tenant_id/location_id ของยุค 4.0) อ่านไม่ออก จึงตกเป็น "ไม่บังคับ" — เป็นการมองข้าม
// ไม่ใช่การรายงานผิด และ seeder ส่งสองตัวนั้นครบอยู่แล้ว
//
// ไม่ต้องมี DB รันจาก apps/web:
//   npx tsx --test ../../scripts/insert-required-columns-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.join(ROOT, "db", "migrations");
const SCAN_ROOTS = ["apps/web", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);

/**
 * ตารางที่ migration สองไฟล์นิยามด้วยคอลัมน์ที่ขัดกัน — ฐานจริงจะได้สคีมาของไฟล์ที่รันก่อน
 * ส่วนอีกไฟล์ข้ามตัวเองเงียบ ๆ (CREATE TABLE IF NOT EXISTS) แปลว่า "คอลัมน์ที่บังคับ"
 * ของตารางพวกนี้อ่านจาก db/migrations ไม่ได้เลย จึงอยู่นอกขอบเขตของด่านนี้
 * หนี้ก้อนนี้เป็นของ `migration-order-contract` ซึ่งตรึงไว้เป็นลิสต์ที่ต้องตรงเป๊ะแล้ว
 */
const UNDERIVABLE = ["roles", "scam_phones_summary"];

type ColumnState = { notNull: boolean; hasDefault: boolean; generated: boolean };

/** แยกรายการที่คั่นด้วย , ที่ระดับบนสุด — วงเล็บซ้อนได้ (NUMERIC(12,2), CHECK (...)) */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** เนื้อในวงเล็บที่เปิดที่ `open` ถึงตัวปิดที่จับคู่กัน */
function balanced(sql: string, open: number): string {
  let depth = 1;
  let i = open;
  while (i < sql.length && depth > 0) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    i++;
  }
  return sql.slice(open, i - 1);
}

const TABLE_CONSTRAINT = /^\s*(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT|EXCLUDE|LIKE)\b/i;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => /^\d+\.\d+__.*\.sql$/.test(file))
    .sort((a, b) => {
      const [, am, an] = a.match(/^(\d+)\.(\d+)__/)!.map(Number);
      const [, bm, bn] = b.match(/^(\d+)\.(\d+)__/)!.map(Number);
      return am - bm || an - bn;
    });
}

/**
 * เดินไมเกรชันตามลำดับเลข แล้วสะสมสถานะของแต่ละคอลัมน์
 * คอลัมน์ที่ "ต้องส่งค่า" = NOT NULL + ไม่มี DEFAULT + ไม่ใช่ serial/generated
 */
function requiredColumns(): Map<string, Set<string>> {
  const state = new Map<string, Map<string, ColumnState>>();
  const column = (table: string, name: string): ColumnState => {
    const columns = state.get(table) ?? new Map<string, ColumnState>();
    state.set(table, columns);
    const existing = columns.get(name) ?? { notNull: false, hasDefault: false, generated: false };
    columns.set(name, existing);
    return existing;
  };

  for (const file of migrationFiles()) {
    // คอมเมนต์ในไฟล์นี้อธิบายรูปแบบ SQL อยู่บ่อย ๆ ตัดออกก่อนเสมอ
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");

    const creates = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let create: RegExpExecArray | null;
    while ((create = creates.exec(sql))) {
      for (const raw of splitTopLevel(balanced(sql, creates.lastIndex))) {
        const definition = raw.trim();
        if (!definition || TABLE_CONSTRAINT.test(definition)) continue;
        const name = /^([a-z_][a-z0-9_]*)\s/i.exec(definition)?.[1];
        if (!name) continue;
        const col = column(create[1], name);
        if (/\bNOT\s+NULL\b/i.test(definition) || /\bPRIMARY\s+KEY\b/i.test(definition)) col.notNull = true;
        if (/\bDEFAULT\b/i.test(definition)) col.hasDefault = true;
        if (/\b(?:BIG|SMALL)?SERIAL\b/i.test(definition) || /\bGENERATED\b/i.test(definition)) col.generated = true;
      }
    }

    const alters = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\b([\s\S]*?);/gi;
    let alter: RegExpExecArray | null;
    while ((alter = alters.exec(sql))) {
      const table = alter[1];
      for (const raw of splitTopLevel(alter[2])) {
        const action = raw.trim();

        const added = /^ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)\s+([\s\S]*)$/i.exec(action);
        if (added) {
          const col = column(table, added[1]);
          if (/\bNOT\s+NULL\b/i.test(added[2])) col.notNull = true;
          if (/\bDEFAULT\b/i.test(added[2])) col.hasDefault = true;
          if (/\b(?:BIG|SMALL)?SERIAL\b/i.test(added[2]) || /\bGENERATED\b/i.test(added[2])) col.generated = true;
          continue;
        }

        const changed = /^ALTER(?:\s+COLUMN)?\s+([a-z_][a-z0-9_]*)\s+([\s\S]*)$/i.exec(action);
        if (changed) {
          const col = column(table, changed[1]);
          if (/^SET\s+NOT\s+NULL/i.test(changed[2])) col.notNull = true;
          if (/^DROP\s+NOT\s+NULL/i.test(changed[2])) col.notNull = false;
          if (/^SET\s+DEFAULT/i.test(changed[2])) col.hasDefault = true;
          if (/^DROP\s+DEFAULT/i.test(changed[2])) col.hasDefault = false;
          continue;
        }

        const dropped = /^DROP COLUMN\s+(?:IF EXISTS\s+)?([a-z_][a-z0-9_]*)/i.exec(action);
        if (dropped) state.get(table)?.delete(dropped[1]);
      }
    }
  }

  const required = new Map<string, Set<string>>();
  for (const [table, columns] of state) {
    if (UNDERIVABLE.includes(table)) continue;
    const names = [...columns.entries()]
      .filter(([, col]) => col.notNull && !col.hasDefault && !col.generated)
      .map(([name]) => name);
    if (names.length) required.set(table, new Set(names));
  }
  return required;
}

type InsertSite = { file: string; line: number; table: string; columns: string[]; kind: "sql" | "bulk" };

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(ROOT, root));
  return found;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;
const isIdentifier = (token: string) => /^[a-z_][a-z0-9_]*$/.test(token);

/** INSERT ที่มีลิสต์คอลัมน์เป็นชื่อธรรมดาล้วน — ตัวที่ประกอบคอลัมน์ตอนรันอ่านไม่ได้ ข้ามไป */
function insertSites(): InsertSite[] {
  const sites: InsertSite[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const relative = path.relative(ROOT, file).split(path.sep).join("/");

    const inserts = /INSERT INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
    let insert: RegExpExecArray | null;
    while ((insert = inserts.exec(src))) {
      const tokens = insert[2].split(",").map((token) => token.trim());
      if (!tokens.every(isIdentifier)) continue;
      sites.push({ file: relative, line: lineOf(src, insert.index), table: insert[1], columns: tokens, kind: "sql" });
    }

    // devSeed ใช้ helper ที่ประกอบ INSERT จาก (table, cols[]) — ลิสต์คอลัมน์อยู่คนละที่กับ SQL
    const bulks = /bulkInsert\(\s*\w+\s*,\s*"([a-z_][a-z0-9_]*)"\s*,\s*(\[[\s\S]*?\])\s*,/g;
    let bulk: RegExpExecArray | null;
    while ((bulk = bulks.exec(src))) {
      const tokens = [...bulk[2].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
      sites.push({ file: relative, line: lineOf(src, bulk.index), table: bulk[1], columns: tokens, kind: "bulk" });
    }
  }
  return sites;
}

test("ตัวอ่านไมเกรชันต้องอ่านออกจริง ไม่ใช่คืนลิสต์ว่างแล้วเขียว", () => {
  const required = requiredColumns();
  assert.ok(required.size > 100, `อ่านคอลัมน์บังคับได้แค่ ${required.size} ตาราง — ตัวอ่านน่าจะพัง`);

  const orderItems = required.get("bms_order_items");
  assert.ok(orderItems, "อ่าน bms_order_items ไม่เจอ");
  // unit_price มาจาก CREATE TABLE (3.3) · receipt_unit_price มาจาก ALTER ... SET NOT NULL (9.22)
  // สองทางนี้คือทั้งสองรูปที่ตัวอ่านต้องรองรับ
  assert.ok(orderItems!.has("unit_price"), "คอลัมน์ NOT NULL จาก CREATE TABLE หายไป");
  assert.ok(orderItems!.has("receipt_unit_price"), "คอลัมน์ที่ถูก SET NOT NULL ทีหลังหายไป");
  // vat_category / pricing_snapshot เป็น NOT NULL แต่มี DEFAULT — ผู้เรียกไม่ต้องส่ง
  assert.ok(!orderItems!.has("vat_category"), "คอลัมน์ที่มี DEFAULT ต้องไม่ถูกนับว่าบังคับ");
  assert.ok(!orderItems!.has("pricing_snapshot"), "คอลัมน์ที่มี DEFAULT ต้องไม่ถูกนับว่าบังคับ");
  assert.ok(!orderItems!.has("id"), "คอลัมน์ serial ต้องไม่ถูกนับว่าบังคับ");
});

test("ตัวสแกน INSERT ต้องเห็นทั้งสองรูปที่ repo นี้ใช้จริง", () => {
  const sites = insertSites();
  assert.ok(sites.length > 100, `เจอ INSERT แค่ ${sites.length} จุด — ตัวสแกนน่าจะพัง`);
  assert.ok(
    sites.some((site) => site.kind === "bulk" && site.table === "bms_order_items"),
    "อ่าน bulkInsert ของ bms_order_items ไม่เจอ — เส้นที่เคยพังจริงอยู่ตรงนี้"
  );
  assert.ok(
    sites.some((site) => site.kind === "sql" && site.table === "bms_order_items"),
    "อ่าน INSERT INTO bms_order_items ไม่เจอ"
  );
  for (const site of sites) {
    assert.ok(site.columns.length > 0, `${site.file}:${site.line} อ่านคอลัมน์ไม่ได้สักตัว`);
  }
});

test("ทุก INSERT ต้องส่งค่าคอลัมน์ที่ห้ามว่างครบ", () => {
  const required = requiredColumns();
  const gaps = insertSites()
    .map((site) => ({
      site,
      missing: [...(required.get(site.table) ?? new Set<string>())].filter(
        (column) => !site.columns.includes(column)
      ),
    }))
    .filter((entry) => entry.missing.length)
    .map(({ site, missing }) => `${site.file}:${site.line} ${site.table} ขาด: ${missing.join(", ")}`)
    .sort();

  assert.deepEqual(
    gaps,
    [],
    "INSERT พวกนี้จะล้มด้วย 23502 ตอนมีคนเดินเส้นนั้นจริง:\n" + gaps.join("\n")
  );
});

test("ตารางที่ยกเว้นต้องเป็นตัวที่ไมเกรชันนิยามขัดกันเองเท่านั้น", () => {
  // ยกเว้นเพราะ "อ่านจากไมเกรชันไม่ได้" ไม่ใช่เพราะ "อยากให้เขียว" — แก้ต้นเหตุเมื่อไร
  // ต้องลบชื่อออกจากที่นี่ด้วย ไม่งั้นแดง
  const conflicted = new Map<string, Set<string>[]>();
  // ทุกไฟล์ .sql ไม่ใช่เฉพาะที่มีเลข — `001_normalize_roles_phase1.sql` ไม่มีเลขแต่เป็น
  // ไมเกรชันจริง และเป็นคู่ขัดแย้งของ `1.24__roles.sql` พอดี
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    const creates = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let create: RegExpExecArray | null;
    while ((create = creates.exec(sql))) {
      const columns = new Set(
        splitTopLevel(balanced(sql, creates.lastIndex))
          .map((raw) => raw.trim())
          .filter((definition) => definition && !TABLE_CONSTRAINT.test(definition))
          .map((definition) => /^([a-z_][a-z0-9_]*)\s/i.exec(definition)?.[1])
          .filter((name): name is string => Boolean(name))
      );
      if (!columns.size) continue;
      conflicted.set(create[1], [...(conflicted.get(create[1]) ?? []), columns]);
    }
  }

  const disagree = [...conflicted.entries()]
    .filter(([, definitions]) =>
      definitions.some((a, i) =>
        definitions.slice(i + 1).some((b) =>
          [...a].some((column) => !b.has(column)) && [...b].some((column) => !a.has(column))
        )
      )
    )
    .map(([table]) => table)
    .sort();

  assert.deepEqual(disagree, [...UNDERIVABLE].sort());
});
