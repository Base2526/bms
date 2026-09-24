import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const { Client } = pg;
const VERSIONED = /^(\d+)\.(\d+)__.*\.sql$/;
const SPECIAL_ROLE_MIGRATION = "001_normalize_roles_phase1.sql";
const EXCLUDED = new Map([
  ["001_normalize_roles_phase1_ROLLBACK.sql", "rollback script"],
  ["002_normalize_roles_phase3_cleanup.sql", "breaking cleanup is not part of the live schema"],
  ["tenant+cough+diarrhea.sql", "tenant-specific pharmacy template"],
  ["1.24__roles.sql", "superseded incompatible role schema; 001 is authoritative"],
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function dbConfig() {
  return {
    host: required("POSTGRES_HOST"),
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: required("POSTGRES_DB"),
    user: required("POSTGRES_USER"),
    password: required("POSTGRES_PASSWORD"),
  };
}

function checksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function withoutTransactionWrappers(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;\s*$/i.test(line))
    .join("\n");
}

function compareVersions(a, b) {
  const av = a.match(VERSIONED);
  const bv = b.match(VERSIONED);
  if (!av || !bv) return a.localeCompare(b, "en");
  return Number(av[1]) - Number(bv[1]) || Number(av[2]) - Number(bv[2]) || a.localeCompare(b, "en");
}

async function migrationFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const versioned = entries
    .filter((entry) => entry.isFile() && VERSIONED.test(entry.name) && !EXCLUDED.has(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersions);

  const roleInsertAt = versioned.findIndex((name) => compareVersions(name, "1.24__roles.sql") >= 0);
  versioned.splice(roleInsertAt < 0 ? versioned.length : roleInsertAt, 0, SPECIAL_ROLE_MIGRATION);

  const undeclared = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .filter((name) => !VERSIONED.test(name) && name !== SPECIAL_ROLE_MIGRATION && !EXCLUDED.has(name));
  if (undeclared.length) throw new Error(`Unclassified SQL migrations: ${undeclared.join(", ")}`);
  return versioned;
}

async function applyOne(client, name, sql) {
  const digest = checksum(sql);
  const existing = await client.query(
    `SELECT checksum FROM bms_local_schema_migrations WHERE name = $1`,
    [name],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== digest) {
      throw new Error(`Migration ${name} changed after it was applied; refusing to continue`);
    }
    console.log(`skip  ${name}`);
    return;
  }

  console.log(`apply ${name}`);
  await client.query("BEGIN");
  try {
    await client.query(withoutTransactionWrappers(sql));
    await client.query(
      `INSERT INTO bms_local_schema_migrations(name, checksum) VALUES ($1, $2)`,
      [name, digest],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function main() {
  if (process.env.BMS_DEPLOYMENT_MODE !== "retail-local") {
    throw new Error("BMS_DEPLOYMENT_MODE=retail-local is required for the local migration runner");
  }

  const migrationsDir = path.resolve(required("BMS_MIGRATIONS_DIR"));
  const initFile = path.resolve(required("BMS_DB_INIT_FILE"));
  const client = new Client(dbConfig());
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('bms-retail-local-migrations'))");
    const initSql = await fs.readFile(initFile, "utf8");
    await client.query(withoutTransactionWrappers(initSql));
    await client.query(`
      CREATE TABLE IF NOT EXISTS bms_local_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await applyOne(client, "000__base.sql", initSql);

    for (const name of await migrationFiles(migrationsDir)) {
      const sql = await fs.readFile(path.join(migrationsDir, name), "utf8");
      await applyOne(client, name, sql);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('bms-retail-local-migrations'))").catch(() => undefined);
    await client.end();
  }
  console.log("Retail Local schema is current");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
