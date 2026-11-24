// =============================================================
// Platform SQL console: read-only mode refuses whole function families, and its connection is
// never handed back to the application pool.
// -------------------------------------------------------------
// The keyword filter matched `\bkeyword\b`, and `_` is a word character, so names such as
// pg_advisory_lock, pg_read_binary_file, pg_ls_dir, pg_stat_file, lo_get and set_config passed in
// "read-only" mode. A session-level advisory lock is not released by ROLLBACK; the connection then
// went back to the pool still holding it and could block application code using the same key.
// Found 2026-11-24 (GraphQL sweep). Validation runs before any database connection is opened.
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runReadOnlySql, validateSqlConsoleInput } from "../apps/web/lib/bms/sqlConsole.ts";

test("read-only mode refuses server-file, large-object, advisory-lock, sleep and config functions", async () => {
  for (const sql of [
    "SELECT pg_advisory_lock(42)",
    "SELECT pg_try_advisory_lock_shared(1)",
    "SELECT pg_read_binary_file('/etc/passwd')",
    "SELECT * FROM pg_ls_dir('.')",
    "SELECT pg_stat_file('postgresql.conf')",
    "SELECT lo_get(16400)",
    "SELECT set_config('bms.tenant_id', 'x', false)",
    "SELECT pg_sleep_for('5 seconds')",
    "WITH x AS (SELECT dblink_exec('dbname=x', 'DELETE FROM t')) SELECT 1",
  ]) {
    const result = await runReadOnlySql(sql);
    assert.equal(result.ok, false, sql);
    assert.match(String(result.error), /ห้ามใช้|not allowed/i, sql);
  }
});

test("ordinary read-only queries are not caught by the function families", () => {
  for (const sql of ["SELECT relname FROM pg_stat_user_tables", "SELECT * FROM pg_stat_activity",
    "SELECT 'lo_' AS label", "SELECT lot_no, low_stock FROM bms_inventory_lots"]) {
    assert.doesNotThrow(() => validateSqlConsoleInput(sql, { allowWrite: false }), sql);
  }
});

test("write mode (dev only) still refuses server files, large objects and dblink", () => {
  for (const sql of ["SELECT pg_read_binary_file('x')", "SELECT lo_import('/tmp/x')", "SELECT dblink_exec('x','y')"]) {
    assert.throws(() => validateSqlConsoleInput(sql, { allowWrite: true }), /ห้ามใช้/, sql);
  }
});

test("the console discards its connection instead of returning session state to the pool", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/sqlConsole.ts", import.meta.url), "utf8");
  const releases = [...source.matchAll(/client\.release\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(releases.length >= 2, "both console runners release their client");
  assert.deepEqual(releases.filter((arg) => arg !== "true"), [], "every console release must destroy the connection");
});
