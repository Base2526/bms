import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assessReleaseEvidence } from "./release-evidence-check.mts";

const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const pass = { outcome: "PASS" as const, reference: "https://evidence.example.test/run/1" };
const gates = {
  schema: pass, configuration: pass, web: pass, database: pass,
  browser: pass, mobile: pass, desktop: pass, backupRestore: pass,
};

test("release evidence is tied to the clean exact commit and every workflow", () => {
  const manifest = { commit, dirty: false, features: [{ id: "orders.lifecycle", requires: [] }, { id: "pos.operations", requires: [] }] };
  const evidence = { schemaVersion: 1 as const, commit, artifactDigest: digest, target: "staging", gates,
    features: { "orders.lifecycle": pass, "pos.operations": pass } };
  const submitted = assessReleaseEvidence(manifest, evidence);
  assert.equal(submitted.status, "EVIDENCE_SUBMITTED_FOR_REVIEW");
  assert.deepEqual(submitted.problems, []);

  const changed = assessReleaseEvidence({ ...manifest, dirty: true }, { ...evidence, commit: "c".repeat(40), features: { "orders.lifecycle": pass } });
  assert.equal(changed.status, "INCOMPLETE");
  assert.ok(changed.problems.some((problem) => problem.includes("clean commit")));
  assert.ok(changed.problems.some((problem) => problem.includes("record commit")));
  assert.ok(changed.problems.some((problem) => problem.includes("pos.operations")));
});

test("failed, unexplained and unreferenced gates remain visible", () => {
  const report = assessReleaseEvidence(
    { commit, dirty: false, features: [{ id: "tax.etax", requires: [] }] },
    { schemaVersion: 1, commit, artifactDigest: digest, target: "pilot", gates: {
      ...gates, database: { outcome: "FAIL", reference: "db-run-9" },
      mobile: { outcome: "NOT_APPLICABLE", reference: "scope-1" },
    }, features: { "tax.etax": { outcome: "PASS", reference: "" } } },
  );
  assert.equal(report.status, "INCOMPLETE");
  assert.ok(report.problems.some((problem) => problem.includes("gate database: failed")));
  assert.ok(report.problems.some((problem) => problem.includes("gate mobile: not-applicable needs a reason")));
  assert.ok(report.problems.some((problem) => problem.includes("feature tax.etax: no evidence reference")));
});

test("a release cannot waive schema, configuration, Web, database or restore evidence", () => {
  const report = assessReleaseEvidence(
    { commit, dirty: false, features: [{ id: "orders.lifecycle", requires: [] }] },
    { schemaVersion: 1, commit, artifactDigest: digest, target: "production", gates: {
      ...gates, schema: { outcome: "NOT_APPLICABLE", reference: "scope-1", reason: "No schema change" },
      mobile: { outcome: "NOT_APPLICABLE", reference: "scope-1", reason: "Web-only release" },
    }, features: { "orders.lifecycle": pass } },
  );
  assert.ok(report.problems.includes("gate schema: must pass for a release review"));
  assert.ok(!report.problems.some((problem) => problem.includes("gate mobile")));
});

test("CLI writes an incomplete report and returns a failing exit code", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bms-release-evidence-"));
  try {
    const manifest = path.join(dir, "manifest.json");
    const record = path.join(dir, "record.json");
    const report = path.join(dir, "report.json");
    writeFileSync(manifest, JSON.stringify({ commit, dirty: false, features: [{ id: "orders.lifecycle", requires: [] }] }));
    writeFileSync(record, JSON.stringify({ schemaVersion: 1, commit, artifactDigest: digest, target: "staging", gates: {}, features: {} }));
    const cli = path.resolve(import.meta.dirname, "../apps/web/node_modules/tsx/dist/cli.mjs");
    const script = path.resolve(import.meta.dirname, "release-evidence-check.mts");
    const blank = path.join(dir, "blank.json");
    const init = spawnSync(process.execPath, [cli, script, "--manifest", manifest, "--template", blank], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    assert.equal(JSON.parse(readFileSync(blank, "utf8")).features["orders.lifecycle"].outcome, "");
    const run = spawnSync(process.execPath, [cli, script, "--manifest", manifest, "--record", record, "--output", report], { encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
    const output = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(output.status, "INCOMPLETE");
    assert.ok(output.problems.includes("feature orders.lifecycle: no outcome"));
  } finally {
    assert.ok(dir.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dir).startsWith("bms-release-evidence-"));
    rmSync(dir, { recursive: true, force: true });
  }
});
