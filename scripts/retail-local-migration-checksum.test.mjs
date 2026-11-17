import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  canonicalizeMigrationSql,
  compatibleMigrationChecksums,
  migrationChecksum,
  previouslyAppliedMigrationChecksums,
} from "../apps/web/scripts/retail-local-migration-checksum.mjs";

const lf = "CREATE TABLE example (\n  id BIGINT PRIMARY KEY\n);\n";
const crlf = lf.replace(/\n/g, "\r\n");
const mixed = crlf.replace("PRIMARY KEY\r\n", "PRIMARY KEY\n");

test("migration checksums ignore platform newline differences", () => {
  assert.equal(canonicalizeMigrationSql(crlf), lf);
  assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
  assert.equal(migrationChecksum(lf), migrationChecksum(mixed));
  assert.ok(compatibleMigrationChecksums(mixed).has(migrationChecksum(lf)));
});

test("migration checksums still reject SQL content changes", () => {
  const changed = lf.replace("BIGINT", "UUID");
  assert.notEqual(migrationChecksum(lf), migrationChecksum(changed));
  assert.ok(!compatibleMigrationChecksums(changed).has(migrationChecksum(lf)));
});

test("the 10.121 timeout repair accepts only the exact pre-timeout SQL checksum", () => {
  const name = "10.121__bms_verified_shop_owner_administrator.sql";
  const updated = readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
  const operationalBlock = [
    "-- Bound this one repair without changing the session or server defaults.",
    "-- A shorter live statement_timeout previously canceled the historical lookup.",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '2min';",
    "SELECT pg_advisory_xact_lock(hashtextextended('bms-verified-shop-owner-repair', 0));",
  ].join("\n") + "\n";
  assert.ok(updated.includes(operationalBlock));
  const original = updated.replace(operationalBlock, "");
  assert.deepEqual(
    [...previouslyAppliedMigrationChecksums(name)].sort(),
    [...compatibleMigrationChecksums(original)].sort(),
  );
  assert.equal(previouslyAppliedMigrationChecksums("10.128__bms_verified_shop_owner_repair_retry.sql").size, 0);
  assert.ok(!previouslyAppliedMigrationChecksums(name).has(migrationChecksum(updated)));
  assert.ok(!previouslyAppliedMigrationChecksums(name).has(migrationChecksum(original + "-- changed")));
});

test("audit migration renames accept only the original 10.122 and 10.123 SQL", () => {
  const runner = readFileSync(new URL("../apps/web/scripts/retail-local-migrate.mjs", import.meta.url), "utf8");
  for (const [oldNumber, newNumber, basename] of [
    ["10.122", "10.131", "bms_audit_attribution_security_events.sql"],
    ["10.123", "10.132", "bms_audit_legacy_actor_lookup.sql"],
  ]) {
    const oldName = `${oldNumber}__${basename}`;
    const newName = `${newNumber}__${basename}`;
    const current = readFileSync(new URL(`../db/migrations/${newName}`, import.meta.url), "utf8");
    const original = current.replace(`-- ${newNumber}:`, `-- ${oldNumber}:`);
    assert.notEqual(original, current);
    const mapping = runner.slice(runner.indexOf(`"${newName}"`), runner.indexOf("],", runner.indexOf(`"${newName}"`)));
    assert.ok(mapping.includes(`name: "${oldName}"`));
    for (const checksum of compatibleMigrationChecksums(original)) {
      assert.ok(mapping.includes(`"${checksum}"`), `${oldName} checksum is missing`);
    }
  }
});
