import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function harness({ failAudit = false, failRead = false } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false;
  let rolledBack = false;
  let released = false;
  const client = {
    release: () => { released = true; },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql === "COMMIT") { committed = true; return { rowCount: 0, rows: [] }; }
      if (sql === "ROLLBACK") { rolledBack = true; return { rowCount: 0, rows: [] }; }
      if (sql.includes("UPDATE bms_ai_quality_reviews")) return { rowCount: 1, rows: [{ id: "case-1" }] };
      if (sql.includes("INSERT INTO bms_audit_log")) {
        if (failAudit) throw new Error("audit unavailable");
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM bms_ai_quality_reviews r")) {
        if (failRead) throw new Error("case read unavailable");
        return { rowCount: 1, rows: [{
          id: "case-1", conversation_id: "conversation-1", message_id: "message-1",
          created_at: "2026-11-12T00:00:00Z", updated_at: "2026-11-12T00:00:00Z",
          ai_body: "Verified answer", customer_body: "Question",
        }] };
      }
      if (sql.includes("FROM bms_messages m")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const mocks: Record<string, unknown> = {
    "@/lib/db": {
      getClient: async () => client,
      query: async () => ({ rowCount: 0, rows: [] }),
    },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string, options: unknown) => {
      calls.push({ sql: "beginTenantTx", params: [tenantId, options] });
    } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/bms/aiQuality.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { service: module.exports, calls,
    get committed() { return committed; }, get rolledBack() { return rolledBack; }, get released() { return released; } };
}

test("human AI quality verdict and actor audit commit in one tenant transaction", async () => {
  const h = harness();
  await h.service.reviewAiQualityCase("tenant-a", "case-1", {
    verdict: "FAIL", category: "WRONG_TOOL", note: "Incorrect tool", reviewerId: "admin-1",
  });
  assert.equal(h.committed, true);
  assert.equal(h.released, true);
  assert.ok(h.calls.findIndex(({ sql }) => sql.includes("FROM bms_ai_quality_reviews r")) < h.calls.findIndex(({ sql }) => sql === "COMMIT"));
  assert.deepEqual(h.calls[0], { sql: "beginTenantTx", params: ["tenant-a", { editorId: "admin-1" }] });
  const update = h.calls.find(({ sql }) => sql.includes("UPDATE bms_ai_quality_reviews"));
  assert.deepEqual(update?.params.slice(0, 2), ["tenant-a", "case-1"]);
  const audit = h.calls.find(({ sql }) => sql.includes("INSERT INTO bms_audit_log"));
  assert.deepEqual(audit?.params.slice(0, 3), ["tenant-a", "admin-1", "case-1"]);
  assert.deepEqual(JSON.parse(String(audit?.params[3])), { verdict: "FAIL", category: "WRONG_TOOL" });
  assert.ok(h.calls.findIndex(({ sql }) => sql.includes("INSERT INTO bms_audit_log")) < h.calls.findIndex(({ sql }) => sql === "COMMIT"));
});

test("failed verdict audit rolls back the review and raw note never enters audit", async () => {
  const h = harness({ failAudit: true });
  await assert.rejects(h.service.reviewAiQualityCase("tenant-a", "case-1", {
    verdict: "FAIL", category: "WRONG_TOOL", note: "private reviewer note", reviewerId: "admin-1",
  }), /audit unavailable/);
  assert.equal(h.committed, false);
  assert.equal(h.rolledBack, true);
  assert.equal(h.released, true);
  const audit = h.calls.find(({ sql }) => sql.includes("INSERT INTO bms_audit_log"));
  assert.doesNotMatch(String(audit?.params[3]), /private reviewer note/);
});

test("dismissing a case is attributable and cannot commit without its audit", async () => {
  const h = harness();
  await h.service.dismissAiQualityCase("tenant-a", "case-1", "admin-1");
  assert.equal(h.committed, true);
  const audit = h.calls.find(({ sql }) => sql.includes("INSERT INTO bms_audit_log"));
  assert.match(audit?.sql ?? "", /ai_quality\.dismiss/);
  assert.deepEqual(audit?.params.slice(0, 3), ["tenant-a", "admin-1", "case-1"]);
  const failed = harness({ failAudit: true });
  await assert.rejects(failed.service.dismissAiQualityCase("tenant-a", "case-1", "admin-1"));
  assert.equal(failed.committed, false);
  assert.equal(failed.rolledBack, true);
});

test("case read failure rolls back instead of reporting failure after a committed review", async () => {
  const review = harness({ failRead: true });
  await assert.rejects(review.service.reviewAiQualityCase("tenant-a", "case-1", {
    verdict: "FAIL", category: "WRONG_TOOL", reviewerId: "admin-1",
  }), /case read unavailable/);
  assert.equal(review.committed, false);
  assert.equal(review.rolledBack, true);
  const dismiss = harness({ failRead: true });
  await assert.rejects(dismiss.service.dismissAiQualityCase("tenant-a", "case-1", "admin-1"), /case read unavailable/);
  assert.equal(dismiss.committed, false);
  assert.equal(dismiss.rolledBack, true);
});

test("AI quality resolver requires reviewer permission and delegates the tenant write", () => {
  const source = read("apps/web/graphql/bmsAiQuality.ts");
  for (const marker of ["async bmsReviewAiQualityCase", "async bmsDismissAiQualityCase"]) {
    const block = source.split(marker)[1].split("async bms")[0];
    assert.match(block, /await requirePermission\(ctx, "ai_quality\.review"\)/);
    assert.match(block, /getTenantId\(ctx\)/);
    assert.doesNotMatch(block, /await audit\(/);
  }
});
