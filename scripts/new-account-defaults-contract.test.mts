// Database-free contract for what a brand-new account starts out as.
// Run from apps/web: npx tsx --test ../../scripts/new-account-defaults-contract.test.mts
//
// Every INSERT INTO users in this repo leaves the presentation columns to the column DEFAULT —
// that is deliberate (see 7.81 and 9.67), and it is also why the defaults are easy to break from
// two directions at once: a later migration flipping the DEFAULT back, or a new create path
// passing the old value explicitly. Both are silent; you only find out when a real shop signs up
// and lands somewhere nobody chose.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "db/migrations");

type Versioned = { version: [number, number]; file: string; sql: string };

const migrations: Versioned[] = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((file) => {
    const m = /^(\d+)\.(\d+)/.exec(file);
    if (!m) return null;
    return {
      version: [Number(m[1]), Number(m[2])] as [number, number],
      file,
      sql: readFileSync(path.join(migrationsDir, file), "utf8"),
    };
  })
  .filter((x): x is Versioned => x !== null)
  // This repo applies migrations by hand in version order, so "last writer wins" has to be
  // resolved the same way here — not by readdir order, which is lexical (9.7 before 9.67).
  .sort((a, b) => a.version[0] - b.version[0] || a.version[1] - b.version[1]);

/** The value a fresh users row gets for `column`, after every migration has been applied. */
function effectiveDefault(column: string): { value: string; file: string } | null {
  let winner: { value: string; file: string } | null = null;
  const patterns = [
    new RegExp(`ALTER\\s+COLUMN\\s+${column}\\s+SET\\s+DEFAULT\\s+'([^']+)'`, "gi"),
    new RegExp(`ADD\\s+COLUMN[^;]*?\\b${column}\\b[^;]*?DEFAULT\\s+'([^']+)'`, "gis"),
  ];
  for (const { file, sql } of migrations) {
    // Comments in this repo quote the old value to explain the change (9.67 names 'system' in
    // its rationale and again in its ROLLBACK line) — scoring those would pick the wrong winner.
    const bare = sql.replace(/--[^\n]*/g, "");
    for (const re of patterns) {
      for (const match of bare.matchAll(re)) winner = { value: match[1], file };
    }
  }
  return winner;
}

test("a new account starts on the light theme, not on whatever the OS is set to", () => {
  const found = effectiveDefault("theme_preference");
  assert.ok(found, "no migration defines users.theme_preference at all");
  // /pos and /pos/display are light-only, so 'system' handed a dark-OS shop a dark back office
  // next to a light register — on the two screens their cashiers use all day.
  assert.equal(found.value, "light",
    `users.theme_preference defaults to '${found.value}' (set by ${found.file})`);
});

test("a new account starts in Thai, not in English", () => {
  // 7.81's reasoning, pinned so the same regression cannot come back through a later migration.
  const found = effectiveDefault("language");
  assert.ok(found, "no migration defines users.language at all");
  assert.equal(found.value, "th",
    `users.language defaults to '${found.value}' (set by ${found.file})`);
});

test("no create path hands users a presentation value of its own", () => {
  // A path that passes these explicitly opts itself out of the defaults above, and nothing else
  // in the codebase would notice. Leaving them to the column keeps one answer for every path.
  const files = [
    "apps/web/lib/bms/signup.ts",
    "apps/web/graphql/resolvers.ts",
    "apps/web/lib/bms/testShop.ts",
    "apps/web/lib/bms/devSeed.ts",
  ];
  for (const rel of files) {
    const sql = readFileSync(path.join(root, rel), "utf8");
    for (const match of sql.matchAll(/INSERT\s+INTO\s+users\s*\(([^)]*)\)/gis)) {
      const columns = match[1];
      assert.doesNotMatch(columns, /theme_preference/i,
        `${rel} sets theme_preference on insert — leave it to the column default`);
      assert.doesNotMatch(columns, /\blanguage\b/i,
        `${rel} sets language on insert — leave it to the column default`);
    }
  }
});

test("the stored preference actually reaches the browser", () => {
  // Without this sync the column is decoration: the client would keep resolving its own cookie,
  // which is 'system' for someone who has never chosen, and the default would change nothing.
  const layer = readFileSync(path.join(root, "apps/web/app/SessionLayer.tsx"), "utf8");
  assert.match(layer, /admin\?\.themePreference \?\? user\?\.themePreference/);
  assert.match(layer, /setThemeMode\(sessionThemePreference\)/);
  const me = readFileSync(path.join(root, "apps/web/app/api/auth/me/route.ts"), "utf8");
  assert.match(me, /theme_preference/);
});
