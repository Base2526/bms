import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "apps/web/node_modules/tsx/dist/cli.mjs");
const script = path.join(root, "scripts/release-features.mts");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, script, ...args], {
  cwd: root, encoding: "utf8",
});

test("release inventory validates its evidence and emits a commit-bound diff", () => {
  const checked = run("--check");
  assert.equal(checked.status, 0, checked.stderr);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "bms-release-feature-test-"));
  try {
    const first = path.join(temporary, "first");
    const second = path.join(temporary, "second");
    const initial = run("--version", "test-1", "--output", first, "--allow-dirty");
    assert.equal(initial.status, 0, initial.stderr);
    const manifest = JSON.parse(readFileSync(path.join(first, "release-features.json"), "utf8"));
    assert.match(manifest.commit, /^[0-9a-f]{40}$/);
    assert.equal(manifest.version, "test-1");
    assert.equal(manifest.featureCount, manifest.features.length);
    assert.ok(manifest.features.some((feature: { id: string }) => feature.id === "inventory.transfer-lots"));
    assert.equal(manifest.scope, "baseline-in-progress");
    assert.ok(manifest.unmappedTests.length > 0, "missing evidence must remain visible");

    const compared = run("--version", "test-2", "--output", second, "--previous", path.join(first, "release-features.json"), "--allow-dirty");
    assert.equal(compared.status, 0, compared.stderr);
    const diff = JSON.parse(readFileSync(path.join(second, "release-features.json"), "utf8"));
    assert.deepEqual(diff.changes, { added: [], changed: [], removed: [] });
    assert.equal(diff.catalogHash, manifest.catalogHash);
  } finally {
    const safe = path.resolve(temporary);
    assert.ok(safe.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(safe).startsWith("bms-release-feature-test-"));
    rmSync(safe, { recursive: true, force: true });
  }
});

test("release inventory rejects an invalid version", () => {
  const result = run("--version", "../escape", "--output", "ignored", "--allow-dirty");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid release version/);
});
