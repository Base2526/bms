// =============================================================
// db/migrations ต้องสร้างฐานใหม่ได้จริง ไม่ใช่แค่กองไฟล์ที่เคยรันสำเร็จทีละใบ
// -------------------------------------------------------------
// repo นี้ apply migration ด้วยมือตามเลข (db/README.md บอกให้ `psql -f` ทีละไฟล์)
// แปลว่า "ลำดับที่ถูกต้อง" ไม่ได้ถูกบันทึกไว้ที่ไหนเลย นอกจากในความจำของคนที่รัน
// และฐาน production วันนี้คือผลลัพธ์ของลำดับนั้นที่ไม่มีใครเขียนไว้
//
// สามอย่างที่เทสนี้กัน — ทั้งสามเคยเกิดจริงในไดเรกทอรีนี้:
//   1. เลขซ้ำ — เคยมี 7.74 สองไฟล์พร้อมกัน คนไล่ apply เห็นว่า 7.74 ผ่านแล้วก็ข้าม
//      ไป 7.75 อีกไฟล์จึงไม่เคยถูกรัน เงียบสนิท (CLAUDE.local.md § กับดักข้อ 4)
//   2. ไฟล์ที่ไม่มีเลข — ตัวรันอัตโนมัติต้องรู้ว่าจะทำยังไงกับมัน ปล่อยให้ "ข้ามเงียบ ๆ"
//      ไม่ได้ เพราะบางตัวเป็นไมเกรชันจริงที่ต้องรัน (001) บางตัวห้ามรันเด็ดขาด
//      (ROLLBACK / cleanup ที่เป็น breaking change) และบางตัวเป็นแค่ template
//   3. สองไฟล์สร้างตารางชื่อเดียวกันด้วยคอลัมน์ที่ขัดกัน — ไฟล์ที่รันทีหลังใช้
//      CREATE TABLE IF NOT EXISTS จึงข้ามตัวเองเงียบ ๆ แล้วปล่อยให้ schema ผิดค้างไว้
//      ฐานจะไม่ error ตอน apply แต่แอปจะพังตอน query คอลัมน์ที่ไม่มี
//
// ไม่ต้องมี DB รันจาก apps/web:
//   npx tsx --test ../../scripts/migration-order-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = path.resolve(import.meta.dirname, "../db/migrations");
// ชื่อหลัง __ ว่างได้ — 1.27__.sql, 1.29__.sql, 1.30___.sql, 1.31__.sql เป็นแบบนั้นจริง
// อ่านยากแต่ไม่อันตราย เพราะสิ่งที่กำหนดลำดับคือเลข ไม่ใช่ชื่อ
const VERSIONED = /^(\d+)\.(\d+)__.*\.sql$/;

/**
 * ไฟล์ .sql ที่ไม่มีเลขเวอร์ชัน — ทุกตัวต้องถูกประกาศไว้ที่นี่พร้อมเหตุผลและคำสั่งว่า
 * ตัวรันอัตโนมัติควรทำยังไงกับมัน ไฟล์ใหม่ที่โผล่มาโดยไม่มีเลขจะทำให้เทสนี้แดงทันที
 * ซึ่งเป็นสิ่งที่ต้องการ — ของแบบนี้เคยถูกวางทิ้งไว้แล้วไม่มีใครรู้ว่าต้องรันหรือเปล่า
 */
const UNVERSIONED: Record<string, { apply: boolean; why: string }> = {
  "001_normalize_roles_phase1.sql": {
    apply: true,
    why: "ไมเกรชันจริง — เป็นที่เดียวที่สร้างตาราง roles ตามสคีมาที่แอปใช้อยู่ ต้องรันก่อน 1.24",
  },
  "001_normalize_roles_phase1_ROLLBACK.sql": {
    apply: false,
    why: "สคริปต์ย้อนกลับของ 001 — รันอัตโนมัติไม่ได้เด็ดขาด",
  },
  "002_normalize_roles_phase3_cleanup.sql": {
    apply: false,
    why: "ไฟล์บอกเองว่า 'Date: TBD, run only after Phase 2' และเป็น BREAKING CHANGE (ลบ users.role)",
  },
  "tenant+cough+diarrhea.sql": {
    apply: false,
    why: "template สำหรับ seed protocol ร้านยา — ยังมี 'YOUR_TENANT_ID' ค้างอยู่ ไม่ใช่ไมเกรชัน",
  },
};

/**
 * ตารางที่ถูกสร้างจากสองไฟล์แบบตั้งใจ (repair migration ที่ใช้ IF NOT EXISTS เพื่อกู้ฐาน
 * ที่ apply ไม่ครบ) — ต้องมีเหตุผลกำกับ ไม่ใช่รายชื่อที่โตขึ้นเรื่อย ๆ เพื่อให้เทสเขียว
 */
const KNOWN_CONFLICTS = [
  // ⚠️ ยังไม่ได้ตัดสินใจ — สองรายการนี้คือหนี้ที่มีอยู่จริงในไดเรกทอรีนี้ ไม่ใช่ของที่ยอมรับได้
  //
  // roles: แอปใช้สคีมาของ 001 (SELECT id, name, description, is_active, created_at, updated_at
  // FROM roles — graphql/resolvers.ts) แปลว่า 1.24__roles.sql เป็นไฟล์ที่ตายแล้ว แต่ยังอยู่
  // และมีเลขน้อยกว่า ฐานใหม่ที่ apply ตามเลขจึงได้ roles ผิดสคีมา แล้ว 001 ข้ามตัวเองเงียบ ๆ
  // เพราะเป็น IF NOT EXISTS → ฐานสร้างเสร็จโดยไม่มี error แต่หน้า users/roles พังทั้งหมด
  //
  // scam_phones_summary: ปัญหาเดียวกันในฟีเจอร์ชุมชนยุคก่อน BMS (1.20 vs 1.27)
  //
  // ลิสต์นี้ต้องตรงเป๊ะ ไม่ใช่ allowlist — แก้ต้นเหตุแล้วต้องลบบรรทัดออกด้วย ไม่งั้นเทสแดง
  "roles: 001_normalize_roles_phase1.sql มี [is_active, updated_at] แต่ 1.24__roles.sql มี [key, is_system]",
  "scam_phones_summary: 1.20__scam_phones_summary.sql มี [phone, post_ids, is_deleted] แต่ 1.27__.sql มี [phone_normalized, blocked_by_count, last_blocked_at]",
].sort();

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

test("เลขไมเกรชันไม่ซ้ำกัน — เลขซ้ำแปลว่ามีไฟล์ที่ไม่มีวันถูก apply", () => {
  const seen = new Map<string, string[]>();
  for (const f of files) {
    const m = f.match(VERSIONED);
    if (!m) continue;
    const key = `${m[1]}.${m[2]}`;
    seen.set(key, [...(seen.get(key) ?? []), f]);
  }
  const dupes = [...seen.entries()].filter(([, v]) => v.length > 1);
  assert.deepEqual(dupes, [], "เลขเดียวกันถูกใช้มากกว่าหนึ่งไฟล์:\n" + JSON.stringify(dupes, null, 2));
});

test("ไฟล์ .sql ทุกตัวมีเลข หรือถูกประกาศว่าจะทำอย่างไรกับมัน", () => {
  const undeclared = files.filter((f) => !VERSIONED.test(f) && !(f in UNVERSIONED)).sort();
  assert.deepEqual(
    undeclared,
    [],
    "ไฟล์ที่ไม่มีเลขและไม่ได้ประกาศไว้ — ตัวรันอัตโนมัติจะไม่รู้ว่าต้องรันหรือข้าม:\n" + undeclared.join("\n")
  );
  // ประกาศไว้แล้วแต่ไฟล์หายไป = รายการนี้เก่า ต้องล้างออก ไม่งั้นอ่านแล้วเข้าใจผิด
  const stale = Object.keys(UNVERSIONED).filter((f) => !files.includes(f)).sort();
  assert.deepEqual(stale, [], "ประกาศไว้แต่ไม่มีไฟล์จริงแล้ว:\n" + stale.join("\n"));
});

/** ดึงชื่อคอลัมน์คร่าว ๆ จากบล็อก CREATE TABLE — พอสำหรับเทียบว่าสองนิยามขัดกันไหม */
function columnsOf(sql: string, start: number): Set<string> {
  const open = sql.indexOf("(", start);
  if (open < 0) return new Set();
  let depth = 0;
  let end = open;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const cols = new Set<string>();
  for (const line of sql.slice(open + 1, end).split("\n")) {
    const m = line.match(/^\s*"?([a-z_][a-z_0-9]*)"?\s+[a-z]/i);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (["constraint", "primary", "unique", "foreign", "check", "exclude", "like"].includes(name)) continue;
    cols.add(name);
  }
  return cols;
}

test("ไม่มีตารางไหนถูกนิยามด้วยคอลัมน์ที่ขัดกันจากสองไฟล์", () => {
  const defs = new Map<string, { file: string; cols: Set<string> }[]>();
  for (const f of files.sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const table = m[1].toLowerCase();
      const cols = columnsOf(sql, m.index);
      if (cols.size === 0) continue;
      defs.set(table, [...(defs.get(table) ?? []), { file: f, cols }]);
    }
  }

  const conflicts: string[] = [];
  for (const [table, list] of defs) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const onlyA = [...a.cols].filter((c) => !b.cols.has(c));
        const onlyB = [...b.cols].filter((c) => !a.cols.has(c));
        // ต่างกันคนละทางทั้งสองฝั่ง = สองนิยามที่อยู่ร่วมกันไม่ได้ ไม่ใช่แค่ repair ที่เพิ่มคอลัมน์
        if (onlyA.length && onlyB.length) {
          conflicts.push(
            `${table}: ${a.file} มี [${onlyA.join(", ")}] แต่ ${b.file} มี [${onlyB.join(", ")}]`
          );
        }
      }
    }
  }

  // เทียบกับลิสต์ที่รู้อยู่แล้วแบบตรงเป๊ะ ไม่ใช่ allowlist ที่โตได้ — ของใหม่โผล่ = แดง
  // และแก้ของเก่าจบแล้วไม่ลบบรรทัดออก = แดงเหมือนกัน
  assert.deepEqual(
    conflicts.sort(),
    KNOWN_CONFLICTS,
    "ฐานใหม่จะได้สคีมาของไฟล์ที่รันก่อน แล้วอีกไฟล์ข้ามตัวเองเงียบ ๆ:\n" + conflicts.join("\n")
  );
});
