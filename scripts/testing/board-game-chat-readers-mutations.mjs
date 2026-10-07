// node scripts/testing/board-game-chat-readers-mutations.mjs <backup-stash-sha>
// Only run after gate stops. Temporary mutations are mechanical; restore saved Buffers, never checkout.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = "apps/web/lib/bms/boardGameCafe.ts";
const target = path.join(root, file);
const stash = process.argv[2];
assert.match(stash ?? "", /^[a-f0-9]{40}$/);
const original = readFileSync(target);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalize = (text) => text.replace(/\r\n/g, "\n");
assert.equal(normalize(execFileSync("git", ["show", `${stash}:${file}`], {
  cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
})), normalize(original.toString("utf8")), "stash must contain the current work");

const mutations = [
  { name: "chat-directory-filter", from: "WHERE profile.tenant_id = $1::uuid AND location.active",
    to: "WHERE profile.public_visible AND profile.tenant_id = $1::uuid AND location.active",
    witness: "hidden directory branch still answers rates through the DEFAULT chat reader" },
  { name: "public-directory-leak", from: "WHERE profile.public_visible AND location.active",
    to: "WHERE location.active",
    witness: "public reader alone owns directory visibility and optional tenant filtering" },
  { name: "optional-chat-tenant", from: "WHERE profile.tenant_id = $1::uuid AND location.active",
    to: "WHERE ($1::uuid IS NULL OR profile.tenant_id = $1::uuid) AND location.active",
    witness: "chat reader requires tenant in type and SQL without optional tenant escape" },
  { name: "optional-chat-tenant-type", from: "scope: { tenantId: string; client: QueryClient }",
    to: "scope: { tenantId?: string; client: QueryClient }",
    witness: "chat reader requires tenant in type and SQL without optional tenant escape" },
];
const out = path.join(root, ".test-output/board-game-chat-readers-mutations");
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const mutation of mutations) {
    try {
      const source = original.toString("utf8");
      assert.equal(source.split(mutation.from).length, 2, "mutation anchor must be unique");
      writeFileSync(target, source.replace(mutation.from, mutation.to));
      const result = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", "board-game-customer"], {
        cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 12 * 1024 * 1024,
        env: { ...process.env, BMS_TEST_OUTPUT_DIR: path.join(out, mutation.name) },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, "must fail assertions, not crash or pass");
      const tap = readFileSync(path.join(out, mutation.name, "pure.tap"), "utf8");
      assert.ok(tap.split("\n").some(line => /not ok \d+ - /.test(line) && line.includes(mutation.witness)),
        `intended test must fail: ${mutation.witness}`);
      results.push({ mutation: mutation.name, killed: true, witness: mutation.witness });
      console.log(`KILLED ${mutation.name}: ${mutation.witness}`);
    } finally {
      writeFileSync(target, original);
      assert.equal(hash(readFileSync(target)), hash(original), "byte-exact restore");
    }
  }
} finally {
  assert.equal(hash(readFileSync(target)), hash(original), "final byte-exact restore");
  writeFileSync(path.join(out, "summary.json"), JSON.stringify({ stash, results, restoredSha256: hash(original) }, null, 2) + "\n");
}
assert.equal(results.length, mutations.length);
console.log(`${results.length}/${mutations.length} killed; source restored byte-exact`);
