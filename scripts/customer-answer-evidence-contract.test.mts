import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { customerTools } from "../apps/web/lib/bms/tools/catalog.ts";
import {
  captureCustomerAnswer, evidenceForQuality, fallbackEvidenceQuality, projectToolEvidence,
  PUBLIC_EVIDENCE_TOOLS, STATUS_EVIDENCE_TOOLS, recordCustomerToolEvidence, recordStorePrefetchProjection,
  replyDigest,
} from "../apps/web/lib/bms/customerAnswerEvidence.ts";
import { __toolLoopTest } from "../apps/web/lib/bms/tools/runtime.ts";
import { runEvidenceRetention } from "../apps/web/answer-evidence-retention.mjs";

const quality = () => ({ outcome: "SUCCESS", reasonCodes: [], successfulToolCalls: 1, failedToolCalls: 0 });
const attempt = (tenantId = "FAKE-A", output: unknown = { status: "OK", totalTables: 11 }) =>
  recordCustomerToolEvidence({ tenantId, surface: "customer", tool: "get_board_game_availability", input: {}, output,
    outcome: "ok", source: "SERVER_SELECTED", startedAt: new Date().toISOString() });

test("every actual customer tool, including factory-created tools, has an explicit evidence policy", () => {
  const registry = customerTools().map(tool => tool.name).sort();
  assert.deepEqual([...PUBLIC_EVIDENCE_TOOLS, ...STATUS_EVIDENCE_TOOLS].sort(), registry);
});

test("restaurant, board-game and parking snapshots preserve actual counts, branch, time and publication limits", () => {
  for (const tool of ["get_board_game_availability", "get_restaurant_availability", "get_store_info"]) {
    const facts = { status: "OK", observedAt: "2026-10-08T12:00:00Z", branch: { name: "FAKE main" },
      tableDetails: [{ area: "ชั้น 2", seats: 6, totalTables: 4, availableTables: 2 }], tableDetailsTruncated: true,
      tables: { total: 11, availableNow: 10 },
      branchParking: { branches: [{ name: "FAKE main", parking: { status: "AVAILABLE", carSpaces: 10, details: "ด้านหลังร้าน" } }], truncated: false } };
    assert.deepEqual(projectToolEvidence(tool, {}, facts).output, facts);
  }
});

test("private fields never survive projection; unknown tools and clinical tools fail closed", () => {
  const secret = "FAKE-PRIVATE-SENTINEL";
  const payload = { name: secret, phone: secret, address: secret, note: secret, bankAccount: secret,
    accountNo: secret, promptpayId: secret, paymentAccounts: [{ accountName: secret }], checkoutUrl: secret,
    prescription: secret, fileId: secret, customer: { name: secret }, error: secret, status: "PENDING" };
  for (const tool of ["save_customer_checkout_details", "submit_payment", "get_payment_info", "get_pharmacy_case_status", "unknown_tool"]) {
    assert.doesNotMatch(JSON.stringify(projectToolEvidence(tool, payload, payload)), /FAKE-PRIVATE-SENTINEL/);
  }
  assert.deepEqual(projectToolEvidence("unknown_tool", { qty: 4 }, { amount: 5 }).output, {});
  assert.doesNotMatch(JSON.stringify(projectToolEvidence("get_store_info", {}, { details: "call 0812345678 a@example.com https://host/token?secret=foo" })), /0812345678|example.com|host\/token/);
});

test("UTF-8 limits preserve valid JSON and mark oversized/omitted facts explicitly", () => {
  const p = projectToolEvidence("search_products", { sku: "ก".repeat(5000) }, { products: Array.from({ length: 100 }, () => ({ name: "ก".repeat(500), price: 12 })) });
  assert.ok(Buffer.byteLength(JSON.stringify(p.input)) <= 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(p.output)) <= 8192);
  assert.ok(p.reasons.includes("BYTE_LIMIT"));
  assert.ok(p.reasons.includes("ARRAY_LIMIT"));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(p)));
});

test("record arrays reject unstructured text, while explicit scalar fact arrays remain supported", () => {
  for (const output of [["FAKE-PRIVATE-SENTINEL"], { products: ["FAKE-PRIVATE-SENTINEL", ["FAKE-PRIVATE-SENTINEL"]] }]) {
    const projected = projectToolEvidence("search_products", {}, output);
    assert.doesNotMatch(JSON.stringify(projected.output), /FAKE-PRIVATE-SENTINEL/);
    assert.ok(projected.reasons.includes("INVALID_ARRAY_ITEM"));
  }
  assert.deepEqual(projectToolEvidence("get_product", {}, { sizes: ["S", "L"], tags: ["FAKE"] }).output,
    { sizes: ["S", "L"], tags: ["FAKE"] });
});

test("projection and serialized-result failures never abort the reply or reuse prefetch facts", async () => {
  const result = await captureCustomerAnswer("FAKE-A", "web", async () => {
    recordCustomerToolEvidence({ tenantId: "FAKE-A", surface: "customer", tool: "get_store_info", input: {},
      output: { storeName: "FAKE stale" }, outcome: "ok", source: "SERVER_SELECTED", startedAt: new Date().toISOString() });
    recordStorePrefetchProjection({ get storeName() { throw new Error("FAKE private"); } });
    recordCustomerToolEvidence({ tenantId: "FAKE-A", surface: "customer", tool: "get_store_info", input: {},
      output: {}, serializedOutput: "INVALID JSON", outcome: "ok", source: "MODEL_SELECTED", startedAt: new Date().toISOString() });
    return { reply: "FAKE reply unaffected", quality: quality() };
  });
  const evidence = evidenceForQuality(result.quality)!;
  assert.equal(evidence.status, "PARTIAL");
  assert.equal(evidence.attemptedCalls, 2);
  assert.deepEqual(evidence.calls[0].output, { omitted: true });
  assert.doesNotMatch(JSON.stringify(evidence), /FAKE stale|FAKE private/);
  assert.ok(evidence.reasons.includes("PROJECTION_FAILED"));
});

test("concurrent tenants stay isolated and evidence never serializes into customer results", async () => {
  const results = await Promise.all(["FAKE-A", "FAKE-B"].map(tenant => captureCustomerAnswer(tenant, "web", async () => {
    attempt(tenant); await Promise.resolve(); attempt("FAKE-OTHER");
    return { reply: "FAKE reply", quality: quality() };
  })));
  for (let i = 0; i < results.length; i++) {
    const evidence = evidenceForQuality(results[i].quality)!;
    assert.equal(evidence.tenantId, i ? "FAKE-B" : "FAKE-A");
    assert.equal(evidence.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(results[i]), /turnId|tenantId|calls|safe_output/);
  }
  assert.notEqual(evidenceForQuality(results[0].quality)!.id, evidenceForQuality(results[1].quality)!.id);
});

test("calls remain ordered, capped and fresh; prefetch records model-visible projection", async () => {
  const result = await captureCustomerAnswer("FAKE-A", "web", async () => {
    recordCustomerToolEvidence({ tenantId: "FAKE-A", surface: "customer", tool: "get_store_info", input: {}, output: { storeName: "old" }, outcome: "ok", source: "SERVER_SELECTED", startedAt: new Date().toISOString() });
    recordStorePrefetchProjection({ status: "available", fields: { storeName: "FAKE visible" } });
    for (let n = 0; n < 24; n++) attempt("FAKE-A", { availableTables: n });
    return { reply: "FAKE", quality: quality() };
  });
  const e = evidenceForQuality(result.quality)!;
  assert.equal(e.attemptedCalls, 25); assert.equal(e.calls.length, 20); assert.equal(e.status, "PARTIAL");
  assert.ok(e.reasons.includes("TURN_LIMIT"));
  assert.equal(e.calls[0].source, "MODEL_CONTEXT_PREFETCH");
  assert.equal((e.calls[0].output as any).fields.storeName, "FAKE visible");
  assert.equal(e.calls[19].sequence, 20);
});

test("a thrown pipeline keeps prior attempts for the channel fallback", async () => {
  const failure = new Error("FAKE private exception");
  await assert.rejects(captureCustomerAnswer("FAKE-A", "line", async () => { attempt(); throw failure; }));
  const q = fallbackEvidenceQuality(failure, "FAKE fallback");
  const e = evidenceForQuality(q)!;
  assert.equal(e.calls.length, 1); assert.equal(e.origin, "CHANNEL_FALLBACK");
  assert.equal(q.successfulToolCalls, 1);
  assert.equal(e.replyHash, replyDigest("FAKE fallback"));
  assert.doesNotMatch(JSON.stringify(e), /FAKE private exception/);
});

test("primitive exceptions keep evidence and fallback counters survive the snapshot cap", async () => {
  let failure: unknown;
  try {
    await captureCustomerAnswer("FAKE-A", "web", async () => {
      for (let n = 0; n < 25; n++) attempt();
      throw "FAKE private primitive";
    });
  } catch (error) { failure = error; }
  const q = fallbackEvidenceQuality(failure, "FAKE fallback");
  assert.equal(q.successfulToolCalls, 25);
  assert.equal(evidenceForQuality(q)!.calls.length, 20);
  assert.doesNotMatch(String(failure), /FAKE private primitive/);
});

test("approved runtime captures successful and denied attempts without widening staff capture", async () => {
  const tool: any = { name: "get_store_info", description: "FAKE", surfaces: ["customer"], inputSchema: { type: "object", properties: {} }, execute: async () => ({ ok: true, data: { storeName: "FAKE" } }) };
  const result = await captureCustomerAnswer("FAKE-A", "web", async () => {
    const execCtx: any = { tenantId: "FAKE-A", surface: "customer", actor: "ai:FAKE" };
    await __toolLoopTest.runApproved({ tool, execCtx }, { auditAttempt: async () => {}, reportFailure: async () => {} });
    await __toolLoopTest.runApproved({ tool: { ...tool, surfaces: ["staff"] }, execCtx }, { auditAttempt: async () => {}, reportFailure: async () => {} });
    return { reply: "FAKE", quality: quality() };
  });
  assert.deepEqual(evidenceForQuality(result.quality)!.calls.map(c => c.outcome), ["ok", "denied"]);
});

test("model-selected evidence includes unknown, malformed and duplicate attempts without repeating writes", async () => {
  let writes = 0, providerCalls = 0;
  const tool: any = { name: "create_order", description: "FAKE", surfaces: ["customer"], inputSchema: { type: "object", properties: {} },
    execute: async () => { writes++; return { ok: true, data: { status: "PENDING", total: 120 } }; } };
  const result = await captureCustomerAnswer("FAKE-A", "web", async () => {
    const loop = await __toolLoopTest.run({ tenantId: "FAKE-A", system: "FAKE", messages: [], tools: [tool],
      execCtx: { tenantId: "FAKE-A", surface: "customer", actor: "ai:FAKE", channel: "web" } }, {
      resolveCredentials: async () => ({ apiKey: "FAKE", model: "FAKE", provider: "anthropic", baseUrl: "https://example.invalid", source: "byok" } as any),
      callProvider: async () => ++providerCalls === 1 ? { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "1", name: "unknown_fake", input: {} },
        { type: "tool_use", id: "2", name: "create_order", input: "malformed" },
        { type: "tool_use", id: "3", name: "create_order", input: {} },
        { type: "tool_use", id: "4", name: "create_order", input: {} },
      ] } : { stop_reason: "end_turn", content: [{ type: "text", text: "FAKE reply" }] },
      auditAttempt: async () => {}, reportFailure: async () => {},
    });
    return { reply: loop.reply, quality: quality() };
  });
  const e = evidenceForQuality(result.quality)!;
  assert.equal(writes, 1); assert.equal(e.calls.length, 4);
  assert.deepEqual(e.calls.map(c => c.outcome), ["unknown", "error", "ok", "ok"]);
  assert.equal(e.calls[3].source, "DUPLICATE_SUPPRESSED");
});

test("timeout remains effect-unknown and a late tool completion cannot rewrite the snapshot", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let complete!: (value: any) => void;
  const tool: any = { name: "get_store_info", description: "FAKE", surfaces: ["customer"], inputSchema: { type: "object", properties: {} },
    execute: () => new Promise(resolve => { complete = resolve; }) };
  const pending = captureCustomerAnswer("FAKE-A", "web", async () => {
    await __toolLoopTest.runApproved({ tool, execCtx: { tenantId: "FAKE-A", surface: "customer", actor: "ai:FAKE" } },
      { auditAttempt: async () => {}, reportFailure: async () => {} });
    return { reply: "FAKE timeout", quality: quality() };
  });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30001);
  const result = await pending;
  const e = evidenceForQuality(result.quality)!;
  assert.equal(e.calls[0].outcome, "timeout_effect_unknown");
  const before = JSON.stringify(e);
  complete({ ok: true, data: { storeName: "FAKE late" } });
  await Promise.resolve();
  assert.equal(JSON.stringify(e), before);
});

test("retention follows pages, checks HTTP success, and refuses missing authority", async () => {
  const urls: string[] = [];
  await runEvidenceRetention("http://127.0.0.1:9999", "FAKE", async (url: URL, init: any) => {
    urls.push(String(url)); assert.equal(init.headers["x-cron-secret"], "FAKE");
    return { ok: true, json: async () => ({ nextTenant: urls.length === 1 ? "FAKE-cursor" : null }) };
  });
  assert.equal(urls.length, 2); assert.match(urls[1], /afterTenant=FAKE-cursor/);
  await assert.rejects(runEvidenceRetention("http://localhost", ""), /requires/);
  await assert.rejects(runEvidenceRetention("http://localhost", "FAKE", async () => ({ ok: false, status: 503 })), /503/);
});

test("evidence read APIs retain permission checks and retention refuses missing cron secret", () => {
  const resolver = readFileSync(new URL("../apps/web/graphql/bmsAiQuality.ts", import.meta.url), "utf8");
  assert.match(resolver, /async bmsAiAnswerEvidence\([\s\S]*?requirePermission\(ctx, "ai_quality.view"\)/);
  const route = readFileSync(new URL("../apps/web/app/api/bms/ai/evidence/purge-expired/route.ts", import.meta.url), "utf8");
  assert.match(route, /authorizeCronRequest\(req\)/);
  assert.match(route, /if \(!auth.ok\) return auth.response/);
});
