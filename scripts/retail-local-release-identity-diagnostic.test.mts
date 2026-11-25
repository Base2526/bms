import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Retail Local identity diagnostic is bounded, read-only, and streams storage verification", async () => {
  const source = await readFile(
    new URL("./retail-local-release-identity-diagnostic.mts", import.meta.url),
    "utf8",
  );
  const sql = source.match(/query<Row>\(`([\s\S]*?)`\s*,\s*\[rowLimit\]\)/)?.[1] ?? "";
  assert.match(sql, /^\s*WITH\s/i);
  assert.match(sql, /\bSELECT\b/i);
  assert.match(sql, /LIMIT \$1/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  assert.match(source, /requestedLimit > 10_000/);
  assert.match(source, /inspectStoredFile\(row\.relpath\)/);
  assert.match(source, /storage verification error/);
  assert.match(source, /storageSha256/);
  assert.match(source, /releaseId/);
  assert.match(source, /fileId/);
  assert.doesNotMatch(source, /readStoredFile|Buffer\.concat|arrayBuffer/);
});
