import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const input = { intent: "ORDER", delayMinutes: 30, maxRetry: 2, messageGoal: "CLOSE_SALE" };

function harness(options: { auditFails?: boolean; missing?: boolean } = {}) {
  const events: string[] = [];
  const row = { id: "FAKE-rule", tenant_id: "FAKE-tenant", intent: "ORDER", enabled: true,
    priority: 0, delay_minutes: 30, max_retry: 2, stop_conditions: [], message_goal: "CLOSE_SALE",
    business_hours_only: false, template: null, created_at: new Date(), updated_at: new Date() };
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("INSERT INTO bms_followup_rules") || sql.includes("UPDATE bms_followup_rules")) {
      events.push(`rule:${args[0]}`);
      return { rows: options.missing ? [] : [row], rowCount: options.missing ? 0 : 1 };
    }
    if (sql.includes("DELETE FROM bms_followup_rules")) {
      events.push(`delete:${args[0]}`);
      return { rows: [], rowCount: options.missing ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      events.push(`audit:${args[0]}`);
      if (options.auditFails) throw new Error("FAKE audit failed");
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") events.push(sql);
    return { rows: [], rowCount: 1 };
  } };
  const service = loadWithStubs("apps/web/lib/bms/followups.ts", {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: any, tenantId: string) => { events.push(`begin:${tenantId}`); } },
    "./audit": {}, "./inbox": {}, "./customer360": {}, "./storeProfile": {},
    "./aiMetering": {}, "./ai": {}, "./aiUsage": {}, "./aiProvider": {}, "./shopArchetypes": {},
  });
  return { service, events };
}

test("rule creation and deletion commit tenant write with audit", async () => {
  const created = harness();
  const rule = await created.service.upsertFollowupRule("FAKE-tenant", input, "FAKE-actor");
  assert.equal(rule.id, "FAKE-rule");
  assert.deepEqual(created.events, ["begin:FAKE-tenant", "rule:FAKE-tenant", "audit:FAKE-tenant", "COMMIT", "release"]);

  const deleted = harness();
  assert.equal(await deleted.service.deleteFollowupRule("FAKE-tenant", "FAKE-rule", "FAKE-actor"), true);
  assert.deepEqual(deleted.events, ["begin:FAKE-tenant", "delete:FAKE-tenant", "audit:FAKE-tenant", "COMMIT", "release"]);
});

test("audit failure rolls the rule change back and a missing rule cannot write audit", async () => {
  const failed = harness({ auditFails: true });
  await assert.rejects(failed.service.upsertFollowupRule("FAKE-tenant", input, "FAKE-actor"), /FAKE audit failed/);
  assert.deepEqual(failed.events, ["begin:FAKE-tenant", "rule:FAKE-tenant", "audit:FAKE-tenant", "ROLLBACK", "release"]);

  const missing = harness({ missing: true });
  await assert.rejects(missing.service.upsertFollowupRule("FAKE-tenant", { ...input, id: "FAKE-other-rule" }, "FAKE-actor"),
    /ไม่พบ follow-up rule/);
  assert.equal(missing.events.includes("COMMIT"), false);
  assert.equal(missing.events.some(event => event.startsWith("audit:")), false);
  assert.equal(await missing.service.deleteFollowupRule("FAKE-tenant", "FAKE-other-rule", "FAKE-actor"), false);
});

test("bad rule input is rejected before opening a transaction", async () => {
  const h = harness();
  await assert.rejects(h.service.upsertFollowupRule("FAKE-tenant", { ...input, delayMinutes: 0 }, "FAKE-actor"),
    /delayMinutes/);
  assert.deepEqual(h.events, []);
});
