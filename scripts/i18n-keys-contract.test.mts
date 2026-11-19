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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");

import { getMessage, messages } from "../apps/web/i18n/index.ts";

const WEB = path.resolve(import.meta.dirname, "../apps/web");
const LANGS = ["th", "en"] as const;

/** ไฟล์ที่มีการเรียก t("...") — เดินด้วย Node เพื่อให้ merge gate ใช้ได้ทั้ง Linux/Windows */
const sourceFiles = () => {
  const pending = ["app", "lib", "components", "i18n"];
  const found: string[] = [];
  while (pending.length) {
    const relative = pending.pop()!;
    for (const entry of readdirSync(path.join(WEB, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (/\.[jt]sx?$/.test(entry.name) ) {
        found.push(child);
      }
    }
  }
  return found;
};

/** คีย์ที่เขียนตรง ๆ เท่านั้น — คีย์ที่ประกอบตอนรันตรวจที่นี่ไม่ได้ */
const literalKeys = (src: string) => {
  const ast = ts.createSourceFile("ui.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys: string[] = [];
  function visit(node: any) {
    if (ts.isCallExpression(node) && /^(t|uiText)$/.test(node.expression.getText(ast))) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && arg.text.includes(".")) keys.push(arg.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return keys;
};

test("every literal t() key resolves in th and en", () => {
  const files = sourceFiles();
  assert.ok(files.length > 50, `เจอไฟล์แค่ ${files.length} ไฟล์ — ตัวค้นหาคงพลาด ไม่ใช่ว่าโปรเจกต์เล็กลง`);

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
  function leaves(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    assert.ok(value && typeof value === "object", prefix);
    return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
  }
  assert.deepEqual(leaves(messages.th).sort(), leaves(messages.en).sort());
});

test("literal key discovery handles both quote styles and excludes comments", () => {
  assert.deepEqual(literalKeys(`t('admin.title'); uiText("admin.subtitle"); t(\`admin.footer\`); // t("not.real")`),
    ["admin.title", "admin.subtitle", "admin.footer"]);
});

test("admin UI translations preserve placeholders and interpolate values once", () => {
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [key, th] of Object.entries(messages.th.admin_ui)) {
    const en = getMessage("en", `admin_ui.${key}`);
    assert.ok(th.trim() && en.trim(), key);
    assert.deepEqual(placeholders(th), placeholders(en), key);
  }
  const entry = Object.entries(messages.en.admin_ui).find(([, value]) => value.includes("{v0}"))!;
  assert.equal(getMessage("en", `admin_ui.${entry[0]}`, { v0: "{v1}" }), entry[1].replaceAll("{v0}", "{v1}"));
});
