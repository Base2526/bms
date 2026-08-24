// =============================================================
// Every t() key must resolve in both languages
// -------------------------------------------------------------
// getMessage() falls back to returning the key itself when a lookup misses, so a
// key written into the wrong section does not crash, does not fail the build, and
// does not fail type checking — it renders "admin_products.col_variant_price" on
// the shop's screen instead of a Thai column heading. It has to be seen to be
// found, and it was found twice in two commits (`9.20` put four product keys into
// admin_restock in th.ts and admin_dashboard in en.ts).
//
// This suite reads the source the way a reviewer cannot: it collects every
// literal t("...") key in the app and resolves each one through the real
// resolver, in both th and en.
//
// Scope and its limits: only literal keys are checkable. A key built at runtime
// (`t(\`admin_x.${kind}\`)`) is invisible here, so a dynamic key still needs its
// own care — this catches the mistake that actually keeps happening, not all of
// them.
//
// No database. Run from the repo root:
//   cd apps/web && npx tsx --test ../../scripts/i18n-keys-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getMessage } from "../apps/web/i18n/index.ts";

const WEB = path.resolve(import.meta.dirname, "../apps/web");
const LANGS = ["th", "en"] as const;

/** ไฟล์ที่มีการเรียก t("...") — grep เร็วกว่าการเดินทั้ง tree เอง */
const sourceFiles = () => {
  const out = execFileSync("grep", ["-rl", 't("', "app", "lib", "components"], {
    cwd: WEB,
    encoding: "utf8",
  });
  return out.trim().split("\n").filter(Boolean);
};

/** คีย์ที่เขียนตรง ๆ เท่านั้น — คีย์ที่ประกอบตอนรันตรวจที่นี่ไม่ได้ */
const literalKeys = (src: string) =>
  [...src.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)]
    .map((m) => m[1])
    .filter((key) => key.includes("."));

test("every literal t() key resolves in th and en", () => {
  const files = sourceFiles();
  assert.ok(files.length > 50, `เจอไฟล์แค่ ${files.length} ไฟล์ — grep คงพลาด ไม่ใช่ว่าโปรเจกต์เล็กลง`);

  const missing: string[] = [];
  let checked = 0;
  for (const file of files) {
    for (const key of literalKeys(readFileSync(path.join(WEB, file), "utf8"))) {
      checked++;
      for (const lang of LANGS) {
        // getMessage คืน key ตัวเองเมื่อหาไม่เจอ — นั่นคือสิ่งที่ผู้ใช้เห็นบนจอ
        if (getMessage(lang, key) === key) missing.push(`${lang} · ${key} · ${file}`);
      }
    }
  }

  assert.ok(checked > 1000, `ตรวจไปแค่ ${checked} คีย์ — regex คงพัง`);
  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    "คีย์เหล่านี้จะโผล่เป็นชื่อ key ดิบบนหน้าจอร้าน (ปกติเพราะวางไว้ผิด section)"
  );
});

test("th and en carry the same keys in every section", () => {
  // section ที่มีคีย์ครบเท่ากันแต่คนละชุดคือกับดักถัดไป: หน้าจอภาษาหนึ่งใช้ได้
  // อีกภาษาโชว์ key ดิบ และเทสข้างบนจับได้เฉพาะคีย์ที่ถูกใช้แล้วเท่านั้น
  const sections = (file: string) => {
    const src = readFileSync(path.join(WEB, file), "utf8");
    const found = new Map<string, Set<string>>();
    const re = /^  ([a-z_0-9]+): \{$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index;
      const end = src.indexOf("\n  },", start);
      const body = src.slice(start, end === -1 ? undefined : end);
      found.set(m[1], new Set([...body.matchAll(/^    ([a-z_0-9]+):/gm)].map((k) => k[1])));
    }
    return found;
  };

  const th = sections("i18n/th.ts");
  const en = sections("i18n/en.ts");
  assert.ok(th.size > 20 && en.size > 20, "อ่าน section ไม่ได้ — โครงไฟล์ i18n เปลี่ยนไปแล้ว");

  const drift: string[] = [];
  for (const [name, thKeys] of th) {
    const enKeys = en.get(name);
    if (!enKeys) {
      drift.push(`${name}: มีใน th ไม่มีใน en`);
      continue;
    }
    for (const key of thKeys) if (!enKeys.has(key)) drift.push(`${name}.${key}: ขาดใน en`);
    for (const key of enKeys) if (!thKeys.has(key)) drift.push(`${name}.${key}: ขาดใน th`);
  }
  for (const name of en.keys()) if (!th.has(name)) drift.push(`${name}: มีใน en ไม่มีใน th`);

  assert.deepEqual(drift.sort(), [], "คีย์ที่มีแค่ภาษาเดียว");
});
