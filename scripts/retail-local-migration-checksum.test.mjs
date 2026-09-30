import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeMigrationSql,
  compatibleMigrationChecksums,
  migrationChecksum,
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
