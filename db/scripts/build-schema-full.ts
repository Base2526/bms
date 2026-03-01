#!/usr/bin/env node

/**
 * Build bootstrap schema SQL from db/migrations/*.sql
 *
 * Outputs:
 * - db/schema_full.sql
 * - (optional) db/schema_core.sql, db/schema_auth.sql, db/schema_scam.sql, db/schema_social.sql
 *
 * Notes:
 * - Preserves migration order via numeric prefix sort (1.2 < 1.10 < 1.20)
 * - Keeps SQL mostly verbatim
 * - Removes per-migration BEGIN/COMMIT wrappers (line-only) then wraps the final output in one BEGIN/COMMIT
 * - Tries to reduce duplicate-object errors by upgrading CREATE EXTENSION/TABLE/INDEX to IF NOT EXISTS when safe
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Category = "core" | "auth" | "scam" | "social";

type Migration = {
  fileName: string;
  absPath: string;
  relPath: string;
  versionRaw: string;
  versionParts: number[];
  category: Category;
};

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isSqlFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".sql");
}

function parseMigrationVersion(fileName: string): { versionRaw: string; versionParts: number[] } {
  const base = path.basename(fileName);
  const idx = base.indexOf("__");
  const raw = idx >= 0 ? base.slice(0, idx) : base.replace(/\.sql$/i, "");
  const parts = raw
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  return { versionRaw: raw, versionParts: parts };
}

function compareVersionParts(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function classifyCategory(fileName: string): Category {
  const lower = fileName.toLowerCase();

  // scam domain
  if (/(scam|fraud|phone|bank|money_mule|mule)/i.test(lower)) return "scam";

  // auth / identity
  if (/(user|users|session|sessions|role|roles|auth|password|reset|verify|email)/i.test(lower)) return "auth";

  // social / content / messaging
  if (/(post|posts|comment|comments|bookmark|bookmarks|message|messages|chat|dm|notification|notifications|social|file|files|image|images)/i.test(lower)) {
    return "social";
  }

  return "core";
}

async function readUtf8(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return buf.toString("utf8");
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

function stripPerMigrationTransactions(sql: string): { sql: string; stripped: boolean } {
  // Line-based only: remove standalone BEGIN;/COMMIT;/ROLLBACK;/START TRANSACTION;
  // This avoids nested transactions when we wrap the final output.
  const lines = sql.split(/\r?\n/);
  let stripped = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;\s*$/i.test(line)) {
      stripped = true;
      continue;
    }
    out.push(line);
  }
  return { sql: out.join("\n"), stripped };
}

function upgradeCreateIfNotExists(sql: string): { sql: string; changed: boolean } {
  let changed = false;
  const before = sql;

  // CREATE EXTENSION IF NOT EXISTS
  sql = sql.replace(/(^\s*CREATE\s+EXTENSION\s+)(?!IF\s+NOT\s+EXISTS\b)/gim, (_m, p1: string) => {
    changed = true;
    return `${p1}IF NOT EXISTS `;
  });

  // CREATE TABLE IF NOT EXISTS
  sql = sql.replace(/(^\s*CREATE\s+TABLE\s+)(?!IF\s+NOT\s+EXISTS\b)/gim, (_m, p1: string) => {
    changed = true;
    return `${p1}IF NOT EXISTS `;
  });

  // CREATE [UNIQUE] INDEX IF NOT EXISTS
  sql = sql.replace(/(^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?!IF\s+NOT\s+EXISTS\b)/gim, (_m, p1: string) => {
    changed = true;
    return `${p1}IF NOT EXISTS `;
  });

  if (!changed) return { sql: before, changed: false };
  return { sql, changed };
}

function sectionHeader(fileName: string): string {
  return (
    "-- =====================================================\n" +
    `-- MIGRATION: ${fileName}\n` +
    "-- =====================================================\n\n"
  );
}

function fileHeader(opts: { outRel: string; generatedAt: string; included: string[] }): string {
  const lines: string[] = [];
  lines.push("-- =============================================");
  lines.push("-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)");
  lines.push(`-- Output: ${opts.outRel}`);
  lines.push(`-- GeneratedAt: ${opts.generatedAt}`);
  lines.push("-- Included migrations:");
  for (const f of opts.included) lines.push(`--  - ${f}`);
  lines.push("-- =============================================");
  return `${lines.join("\n")}\n\n`;
}

async function writeUtf8(absPath: string, content: string): Promise<void> {
  await fs.writeFile(absPath, content, "utf8");
}

function parseArgs(argv: string[]): { categorized: boolean } {
  return {
    categorized: argv.includes("--categorized"),
  };
}

async function buildOne(opts: {
  repoRoot: string;
  outAbs: string;
  outRel: string;
  generatedAt: string;
  migrations: Migration[];
}): Promise<{ warnings: string[]; strippedCount: number; upgradedCount: number } > {
  const warnings: string[] = [];
  let strippedCount = 0;
  let upgradedCount = 0;

  const included = opts.migrations.map((m) => m.fileName);
  const parts: string[] = [];

  parts.push(fileHeader({ outRel: opts.outRel, generatedAt: opts.generatedAt, included }));
  parts.push("BEGIN;\n\n");

  for (const m of opts.migrations) {
    const raw = await readUtf8(m.absPath);
    const stripped = stripPerMigrationTransactions(raw);
    if (stripped.stripped) strippedCount++;

    const upgraded = upgradeCreateIfNotExists(stripped.sql);
    if (upgraded.changed) upgradedCount++;

    if (/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i.test(raw)) {
      warnings.push(`Found CREATE INDEX CONCURRENTLY in ${m.relPath}; this cannot run inside a transaction.`);
    }

    parts.push(sectionHeader(m.fileName));
    parts.push(ensureTrailingNewline(upgraded.sql));
    parts.push("\n");
  }

  parts.push("COMMIT;\n");

  await writeUtf8(opts.outAbs, parts.join(""));

  return { warnings, strippedCount, upgradedCount };
}

async function main(): Promise<void> {
  const { categorized } = parseArgs(process.argv.slice(2));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");

  const migrationsDir = path.join(repoRoot, "db", "migrations");
  const outFullAbs = path.join(repoRoot, "db", "schema_full.sql");

  const generatedAt = new Date().toISOString();

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const fileNames = entries
    .filter((e) => e.isFile() && isSqlFileName(e.name))
    .map((e) => e.name);

  if (fileNames.length === 0) {
    throw new Error(`No .sql files found in ${migrationsDir}`);
  }

  const prefixToFiles = new Map<string, string[]>();

  const migrations: Migration[] = fileNames.map((fileName) => {
    const absPath = path.join(migrationsDir, fileName);
    const relPath = toPosix(path.join("db", "migrations", fileName));
    const { versionRaw, versionParts } = parseMigrationVersion(fileName);
    const category = classifyCategory(fileName);

    const arr = prefixToFiles.get(versionRaw) ?? [];
    arr.push(relPath);
    prefixToFiles.set(versionRaw, arr);

    return { fileName, absPath, relPath, versionRaw, versionParts, category };
  });

  const warnings: string[] = [];
  for (const [prefix, files] of prefixToFiles.entries()) {
    if (files.length > 1) warnings.push(`Duplicate migration prefix '${prefix}': ${files.join(", ")}`);
  }

  migrations.sort((a, b) => {
    const c = compareVersionParts(a.versionParts, b.versionParts);
    if (c !== 0) return c;
    return a.fileName.localeCompare(b.fileName, "en");
  });

  console.log(`[schema] migrations: ${migrations.length}`);
  console.log(`[schema] out: ${outFullAbs}`);

  const fullRes = await buildOne({
    repoRoot,
    outAbs: outFullAbs,
    outRel: "db/schema_full.sql",
    generatedAt,
    migrations,
  });

  warnings.push(...fullRes.warnings);

  if (categorized) {
    const byCat: Record<Category, Migration[]> = {
      core: [],
      auth: [],
      scam: [],
      social: [],
    };

    for (const m of migrations) byCat[m.category].push(m);

    const outMap: Array<{ cat: Category; out: string }> = [
      { cat: "core", out: "schema_core.sql" },
      { cat: "auth", out: "schema_auth.sql" },
      { cat: "scam", out: "schema_scam.sql" },
      { cat: "social", out: "schema_social.sql" },
    ];

    for (const { cat, out } of outMap) {
      if (byCat[cat].length === 0) continue;
      const outAbs = path.join(repoRoot, out);
      console.log(`[schema] out: ${outAbs} (${cat}, ${byCat[cat].length} migrations)`);
      const res = await buildOne({ repoRoot, outAbs, outRel: out, generatedAt, migrations: byCat[cat] });
      warnings.push(...res.warnings.map((w) => `${out}: ${w}`));
    }
  }

  console.log(`[schema] stripped per-migration TXN wrappers: ${fullRes.strippedCount}`);
  console.log(`[schema] upgraded CREATE .. IF NOT EXISTS (files changed): ${fullRes.upgradedCount}`);

  if (warnings.length > 0) {
    console.warn("[schema] warnings:");
    for (const w of warnings) console.warn(`  - ${w}`);
  }

  console.log("[schema] done");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error("[schema] fatal:", msg);
  process.exitCode = 1;
});
