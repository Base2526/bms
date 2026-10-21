import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TOOLS, customerTools, staffTools } from "../../apps/web/lib/bms/tools/catalog.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { captureCustomerAnswer, evidenceForQuality, projectToolEvidence, recordCustomerToolEvidence } from "../../apps/web/lib/bms/customerAnswerEvidence.ts";

const presalesNames = ["list_bms_public_plans", "search_bms_presales"];
const names = (tools: typeof ALL_TOOLS) => tools.map(t => t.name).sort();

test("presales never changes the default shop registry or archetype-specific exclusions", () => {
  for (const archetype of [undefined, null, "retail", "restaurant", "board_game_cafe", "pharmacy"]) {
    const shop = customerTools(archetype);
    assert.deepEqual(names(shop), names(customerTools(archetype, "shop_commerce")));
    assert.ok(shop.every(t => !presalesNames.includes(t.name) && !t.sensitive));
    assert.ok(shop.some(t => t.name === "browse_catalog"));
    assert.deepEqual(names(customerTools(archetype, "bms_presales")), presalesNames);
    if (archetype === undefined) continue; // Intentionally returns all customer commerce tools.
    assert.equal(shop.some(t => t.name === "get_pharmacy_service_status"), archetype === "pharmacy");
    assert.equal(shop.some(t => t.name === "get_board_game_rates"), archetype === "board_game_cafe");
    assert.equal(shop.some(t => t.name === "get_restaurant_availability"), archetype === "restaurant");
    assert.equal(shop.some(t => t.name === "reorder"), archetype !== "restaurant");
  }
});

test("staff registry keeps permission filtering and sensitive-tool confirmation metadata", () => {
  const permissions = new Set(ALL_TOOLS.flatMap(t => t.permission ? [t.permission] : []));
  for (const perms of [new Set<string>(), permissions]) {
    const staff = staffTools(perms);
    assert.deepEqual(staff, ALL_TOOLS.filter(t => t.surfaces.includes("staff") && (!t.permission || perms.has(t.permission))));
    assert.ok(staff.every(t => !presalesNames.includes(t.name)));
    assert.ok(staff.filter(t => t.sensitive).every(t => t.permission && !t.surfaces.includes("customer")));
  }
  assert.ok(staffTools(permissions).some(t => t.sensitive));
});

test("runtime denies mode/surface crossing before execution and preserves legacy mode-less context", async () => {
  const shop = customerTools().find(t => t.name === "browse_catalog")!;
  const presales = customerTools(undefined, "bms_presales").find(t => t.name === "search_bms_presales")!;
  for (const [tool, mode, surface, allowed] of [
    [shop, undefined, "customer", true], [shop, "shop_commerce", "customer", true],
    [shop, "bms_presales", "customer", false],
    [presales, undefined, "customer", false], [presales, "shop_commerce", "customer", false],
    [presales, "bms_presales", "customer", true], [presales, "bms_presales", "staff", false],
  ] as const) {
    let executions = 0;
    const audits: any[] = [];
    const result = await __toolLoopTest.runApproved({
      tool: { ...tool, execute: async () => { executions++; return { ok: true, data: {} }; } },
      input: tool === presales ? { query: "BMS" } : {},
      execCtx: { tenantId: "FAKE-tenant", surface, actor: "ai:test", customerMode: mode },
    }, { auditAttempt: async (...args: any[]) => { audits.push(args); }, reportFailure: async () => {} });
    assert.equal(result.result.ok, allowed, `${tool.name}/${mode}/${surface}`);
    assert.equal(executions, allowed ? 1 : 0);
    assert.equal(audits.length, 1);
    assert.equal(audits[0][2], allowed ? "ok" : "denied");
  }
});

test("presales evidence keys cannot widen shop, customer-status or clinical projections", () => {
  const input = { sku: "PUBLIC-SKU", query: "PRIVATE-query", topicIds: ["PRIVATE-topic"], locale: "th" };
  const output = { status: "OK", products: [{ sku: "PUBLIC-SKU", price: 25, id: "PRIVATE-id", answer: "PRIVATE-answer" }],
    id: "PRIVATE-id", answer: "PRIVATE-answer", nextQuestion: "PRIVATE-next", plans: [{ price_monthly: 123 }],
    matches: [{ id: "PRIVATE-topic" }], feature_keys: ["PRIVATE-feature"] };
  for (const name of ["browse_catalog", "get_store_info", "get_order_status", "get_pharmacy_product_facts"]) {
    const projection = projectToolEvidence(name, input, output);
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE-|price_monthly/);
    if (name === "browse_catalog") assert.deepEqual((projection.output as any).products, [{ sku: "PUBLIC-SKU", price: 25 }]);
    if (name.startsWith("get_pharmacy")) {
      assert.deepEqual(projection.input, {});
      assert.deepEqual(projection.output, { status: "OK" });
    }
  }
  const knowledge = projectToolEvidence("search_bms_presales", { query: "BMS", topicIds: ["overview"] },
    { matches: [{ id: "overview", answer: "Published answer", requiresPlans: false }], products: output.products });
  assert.deepEqual(knowledge.output, { matches: [{ id: "overview", answer: "Published answer", requiresPlans: false }] });
  const plans = projectToolEvidence("list_bms_public_plans", {}, { plans: [{ code: "PRO", price_monthly: 123, feature_keys: ["PUBLIC"] }], answer: "PRIVATE-answer" });
  assert.deepEqual(plans.output, { plans: [{ code: "PRO", price_monthly: 123, feature_keys: ["PUBLIC"] }] });
});

test("concurrent shop and presales turns retain request-local evidence without staff or tenant bleed", async () => {
  let unblock!: () => void;
  const bothStarted = new Promise<void>(resolve => { unblock = resolve; });
  let started = 0;
  const results = await Promise.all(["browse_catalog", "search_bms_presales"].map((tool, index) => {
    const tenantId = `FAKE-${index}`;
    return captureCustomerAnswer(tenantId, "line", async () => {
      if (++started === 2) unblock();
      await bothStarted;
      const call = { tenantId, tool, input: {}, output: {}, outcome: "ok", source: "TEST", startedAt: new Date().toISOString() };
      recordCustomerToolEvidence({ ...call, surface: "staff" });
      recordCustomerToolEvidence({ ...call, surface: "customer", tenantId: "FAKE-wrong" });
      recordCustomerToolEvidence({ ...call, surface: "customer" });
      return { reply: "verified", quality: {}, tool };
    });
  }));
  results.forEach((result, index) => {
    const evidence = evidenceForQuality(result.quality)!;
    assert.equal(evidence.tenantId, `FAKE-${index}`);
    assert.equal(evidence.attemptedCalls, 1);
    assert.deepEqual(evidence.calls.map(c => c.tool), [result.tool]);
  });
});
