import assert from "node:assert/strict";
import test from "node:test";

test("actual customer pipeline reaches presales without shop reads/writes and keeps evidence tenant-scoped", async (t) => {
  const globals = globalThis as any;
  const previous = globals.__bmsPostgresPool;
  const calls: { sql: string; args: any[] }[] = [];
  const client = { release() {}, query: async (sql: string, args: any[] = []) => {
    calls.push({ sql, args });
    if (sql.includes("FROM bms_tenant_ai_config")) throw new Error("FAKE-config unavailable; provider must not be contacted");
    if (sql.includes("FROM bms_conversations")) return { rows: [{ id: "FAKE-conversation" }], rowCount: 1 };
    if (sql.includes("FROM bms_messages") || sql.includes("INSERT INTO bms_audit_log")) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  globals.__bmsPostgresPool = { ...client, connect: async () => client };
  try {
    const { sharedRedisClient } = await import("../../apps/web/lib/cache.ts");
    t.mock.method(sharedRedisClient, "get", async () => null);
    t.mock.method(sharedRedisClient, "set", async () => "OK");
    t.mock.method(console, "error", () => {});
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
    const { runPipeline } = await import("../../apps/web/lib/bms/pipeline.ts");
    const { evidenceForQuality, projectToolEvidence } = await import("../../apps/web/lib/bms/customerAnswerEvidence.ts");
    for (const tenant of ["FAKE-A", "FAKE-B"]) {
      const result = await runPipeline("BMS คืออะไร", "line", tenant, "FAKE-customer", { assistantMode: "bms_presales" });
      assert.equal(result.tool, "deterministic:bms-presales");
      assert.match(result.reply, /ระบบบริหารธุรกิจ/);
      assert.deepEqual(result.trace?.map(call => call.tool), ["search_bms_presales"]);
      const evidence = evidenceForQuality(result.quality)!;
      assert.equal(evidence.tenantId, tenant);
      assert.equal(evidence.calls[0].tool, "search_bms_presales");
      assert.equal(evidence.status, "PARTIAL", "router dependencies cannot be described as fully captured");
    }
    assert.equal(network.mock.callCount(), 0);
    for (const call of calls) {
      assert.match(call.sql, /FROM bms_(?:conversations|messages|tenant_ai_config)|INSERT INTO bms_audit_log/);
      assert.ok(["FAKE-A", "FAKE-B"].includes(call.args[0]), "every query is scoped to the server tenant");
    }
    const audit = calls.find(call => call.sql.includes("INSERT INTO bms_audit_log"))!;
    assert.equal(audit.args[2], "ai.tool_call");
    assert.doesNotMatch(audit.args[4], /BMS คืออะไร|FAKE-customer/);
    const projected = projectToolEvidence("search_bms_presales", { query: "price", topicIds: ["plan-catalog"], tenantId: "FAKE-PRIVATE" },
      { locale: "en", matches: [{ id: "plan-catalog", requiresPlans: true, answer: "Verified public text" }], customer: "FAKE-PRIVATE" });
    assert.deepEqual((projected.input as any).topicIds, ["plan-catalog"]);
    assert.equal((projected.output as any).matches[0].requiresPlans, true);
    assert.doesNotMatch(JSON.stringify(projected), /FAKE-PRIVATE/);
  } finally {
    globals.__bmsPostgresPool = previous;
  }
});
