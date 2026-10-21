import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "../testing/webhookHarness.mts";
import * as knowledge from "../../apps/web/lib/bms/platformPresales.ts";
import { customerTools } from "../../apps/web/lib/bms/tools/catalog.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { redactEvidenceText } from "../../apps/web/lib/bms/customerAnswerEvidence.ts";
import { PRESALES_QUESTIONS } from "./bms-presales-question-corpus.mts";

const CTX = { tenantId: "FAKE-tenant", channel: "line", customerRef: "FAKE-customer" };
const PLAN = { code: "PRO", name: "Contract Plan", price_monthly: 4321,
  max_products: 50, max_channels: 2, max_orders_month: 90, max_users: 3,
  max_branches: 2, max_devices: 4, ai_credits_monthly: 1000, feature_keys: [], verifiedAt: "2026-10-21T00:00:00Z" };
const creds = { apiKey: "FAKE-never-sent", model: "claude-sonnet-4-5-20250929", provider: "anthropic" as const,
  baseUrl: "https://api.anthropic.com", source: "byok" as const, usageEventId: "FAKE-usage" };
const text = (value: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text: value }], usage: { input_tokens: 3, output_tokens: 2 } });
const select = (ids: string[], query = "test") => ({ stop_reason: "tool_use", content: [
  { type: "tool_use", id: "FAKE-call", name: "search_bms_presales", input: { query, topicIds: ids } },
], usage: { input_tokens: 5, output_tokens: 4 } });

function harness(options: { responses?: any[]; history?: any[]; historyFails?: boolean; plansFail?: boolean } = {}) {
  const calls = { audits: [] as any[], contexts: [] as any[], histories: [] as any[], loops: [] as any[],
    dependencies: [] as string[], usage: [] as any[], credentials: [] as any[], admissions: 0, provider: 0, plans: 0 };
  const deps = {
    resolveCredentials: async (...args: any[]) => { calls.credentials.push(args); return options.responses ? creds : null; },
    resolveFallbackCredentials: async () => null,
    callProvider: async () => { const result = options.responses?.[calls.provider++]; if (result instanceof Error) throw result; return result ?? text("unverified final text"); },
    recordProviderAttempt: async () => { calls.admissions++; },
    finalizeUsage: async (...args: any[]) => { calls.usage.push(args); },
    auditAttempt: async (...args: any[]) => { calls.audits.push(args); },
    reportFailure: async () => {},
  };
  const api = loadWithStubs("apps/web/lib/bms/platformPresalesAssistant.ts", {
    "./platformPresales": knowledge,
    "./tools/catalog": { customerTools: (_caps: unknown, mode: any) => customerTools(undefined, mode).map(tool => tool.name !== "list_bms_public_plans" ? tool : {
      ...tool, execute: async () => { calls.plans++; if (options.plansFail) throw new Error("FAKE-plan outage"); return { ok: true, data: { plans: [PLAN] } }; },
    }) },
    "./tools/runtime": {
      runToolLoop: async (opts: any) => { calls.loops.push(opts); return __toolLoopTest.run(opts, deps as any); },
      runApprovedTool: (opts: any) => __toolLoopTest.runApproved(opts, deps),
    },
    "./inbox": {
      resolveConversationId: async (...args: any[]) => { calls.contexts.push(args); return `${args[0]}:${args[2]}`; },
      getRecentAiHistory: async (...args: any[]) => { calls.histories.push(args); if (options.historyFails) throw new Error("FAKE-history outage"); return options.history ?? []; },
    },
    "./customerAnswerEvidence": { redactEvidenceText, noteEvidenceDependency: (reason: string) => calls.dependencies.push(reason) },
  });
  return { ...api, calls };
}

test("all 250 prospect questions produce approved fallback answers without a provider", async () => {
  const h = harness();
  for (const [message, ids] of PRESALES_QUESTIONS) {
    const result = await h.answerBmsPresales(message, CTX);
    assert.equal(result.usedAi, false);
    assert.ok(result.reply.length < 5000);
    for (const id of ids.split("|")) {
      const entry = knowledge.BMS_PRESALES_KNOWLEDGE.find(item => item.id === id)!;
      assert.ok(result.reply.includes(entry.answer.th.slice(0, 70)), `${message}: missing approved ${id} answer`);
    }
    assert.ok(result.trace.every((item: any) => item.ok && ["search_bms_presales", "list_bms_public_plans"].includes(item.tool)));
  }
  assert.equal(h.calls.provider, 0);
  assert.ok(h.calls.audits.length >= 250);
});

test("semantic multi-topic routing uses the real shared runtime but never displays fabricated model prose", async () => {
  const h = harness({ responses: [select(["restaurant-operations", "plan-catalog", "commercial-terms"]), text("Activated your account, booked support, only 1 baht, unlimited branches!")] });
  const result = await h.answerBmsPresales("ร้านอาหารสองสาขา POS สี่เครื่อง เริ่มเท่าไรและค่าติดตั้ง", CTX);
  assert.equal(result.usedAi, true);
  assert.match(result.reply, /สถานีครัว/);
  assert.match(result.reply, /4,321/);
  assert.match(result.reply, /ยังไม่มีข้อมูลยืนยัน/);
  assert.doesNotMatch(result.reply, /Activated|booked support|1 baht|unlimited branches/);
  assert.equal(h.calls.plans, 1);
  assert.equal(h.calls.provider, 2);
  assert.equal(h.calls.admissions, 2);
  assert.equal(h.calls.usage.length, 1, "one logical usage finalization for both provider rounds");
  assert.equal(h.calls.credentials.length, 1);
  assert.equal(h.calls.credentials[0][0], CTX.tenantId, "provider/usage admission belongs only to the server-selected OA tenant");
  assert.deepEqual(h.calls.loops[0].tools.map((t: any) => t.name).sort(), ["list_bms_public_plans", "search_bms_presales"]);
  assert.deepEqual(h.calls.audits.map(a => a[1]), ["search_bms_presales", "list_bms_public_plans"]);
});

test("follow-up history is tenant/customer scoped, bounded and redacted, not reused as current facts", async () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: index === 11 ? "Old plan 888888 baht; email private@example.com" : "ร้านบอร์ดเกม" }));
  const h = harness({ history, responses: [select(["board-game-operations"]), text("irrelevant")] });
  const result = await h.answerBmsPresales("แล้วอันนั้นล่ะ", CTX);
  assert.match(result.reply, /ผู้เล่น/);
  assert.doesNotMatch(result.reply, /888888|private@example/);
  assert.deepEqual(h.calls.contexts, [[CTX.tenantId, "line", CTX.customerRef]]);
  assert.deepEqual(h.calls.histories, [[CTX.tenantId, `${CTX.tenantId}:${CTX.customerRef}`, 8]]);
  assert.equal(h.calls.loops[0].messages.length, 9);
  assert.doesNotMatch(JSON.stringify(h.calls.loops[0].messages), /private@example/);
  assert.match(h.calls.loops[0].system, /Old assistant claims.*untrusted/);
  const second = harness({ history: [{ role: "user", content: "ราคาแพ็กเกจ" }], responses: [select(["plan-catalog"])] });
  const fresh = await second.answerBmsPresales("แล้วอันนี้ล่ะ", { ...CTX, tenantId: "FAKE-other", customerRef: "FAKE-other-customer" });
  assert.match(fresh.reply, /4,321/);
  assert.equal(second.calls.contexts[0][0], "FAKE-other");
  assert.equal(second.calls.plans, 1);
});

test("contextless follow-ups clarify; deterministic contextual fallback retains the prior feature", async () => {
  const empty = harness();
  assert.match((await empty.answerBmsPresales("อันนี้", CTX)).reply, /รบกวนระบุ/);
  const h = harness({ history: [{ role: "user", content: "ร้านบอร์ดเกม" }] });
  assert.match((await h.answerBmsPresales("แล้วอันนั้นล่ะ", CTX)).reply, /บอร์ดเกม/);
  assert.equal(h.presalesLocale("Pro", [{ role: "user", content: "ราคาเท่าไร" }]), "th");
});

test("history and provider failure retain verified fallback without a second AI loop", async (t) => {
  t.mock.method(console, "error", () => {});
  const h = harness({ historyFails: true, responses: [new Error("FAKE-provider outage")] });
  const result = await h.answerBmsPresales("BMS คืออะไร", CTX);
  assert.match(result.reply, /ระบบบริหารธุรกิจ/);
  assert.equal(h.calls.loops.length, 1);
  assert.ok(h.calls.dependencies.includes("PRESALES_HISTORY_UNAVAILABLE"));
  assert.ok(result.trace.some((t: any) => t.tool === "search_bms_presales" && t.ok));
});

test("failed plan reads never reuse historical or invented prices", async (t) => {
  t.mock.method(console, "error", () => {});
  const h = harness({ plansFail: true, history: [{ role: "assistant", content: "ราคา 888888 บาท" }] });
  const result = await h.answerBmsPresales("ราคาเท่าไร", CTX);
  assert.match(result.reply, /ตรวจสอบแพ็กเกจ BMS ล่าสุดไม่ได้/);
  assert.doesNotMatch(result.reply, /888888|4,321/);
  assert.equal(h.calls.plans, 1);
  assert.equal(result.trace.find((t: any) => t.tool === "list_bms_public_plans").ok, false);
});

test("malformed model topic choices are audited then fall back to a verified answer", async () => {
  for (const ids of [["invented-feature"], [], Array(6).fill("overview")]) {
    const h = harness({ responses: [select(ids), text("all features supported")] });
    const result = await h.answerBmsPresales("BMS คืออะไร", CTX);
    assert.match(result.reply, /ระบบบริหารธุรกิจ/);
    assert.doesNotMatch(result.reply, /all features supported/);
    assert.ok(h.calls.audits.some(a => a[2] === "error"));
  }
});

test("unknown feature and generic filler do not falsely assert a supported feature", async () => {
  for (const question of ["quantum teleportation คืออะไร", "ยัง", "the", "rocket launch integration"]) {
    const h = harness();
    assert.match((await h.answerBmsPresales(question, CTX)).reply, /ไม่มีคำตอบที่ตรวจสอบ|do not yet have a verified/);
  }
});

test("product prices, loyalty and time passes are not subscription pricing questions", async () => {
  const h = harness();
  for (const question of ["ตั้งราคาส่งต่างจากราคาปลีกได้ไหม", "สะสมแต้มได้ไหม", "ซื้อแพ็กเกจชั่วโมงได้ไหม"]) {
    const result = await h.answerBmsPresales(question, CTX);
    assert.doesNotMatch(result.reply, /Contract Plan/);
  }
  assert.equal(h.calls.plans, 0);
});

test("greetings avoid the provider; English requests render English approved answers", async () => {
  const h = harness();
  assert.match((await h.answerBmsPresales("สวัสดีค่ะ", CTX)).reply, /BMS คือระบบ/);
  assert.equal(h.calls.loops.length, 0);
  assert.match((await h.answerBmsPresales("What is BMS?", CTX)).reply, /business operating system/);
  for (const message of ["ราคา", "เท่าไหร่?", "price?"]) {
    assert.match((await h.answerBmsPresales(message, CTX)).reply, /4,321/);
  }
});

test("all public topics are unique and bilingual; overflow is explicit, never a clipped qualification", async () => {
  const entries = knowledge.BMS_PRESALES_KNOWLEDGE;
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  for (const e of entries) { assert.ok(e.answer.th); assert.ok(e.answer.en); assert.doesNotMatch(e.answer.th + e.answer.en, /\/admin\//); }
  const h = harness({ responses: [select(["readiness-status", "ai-points", "chat-orders", "restaurant-operations", "plan-catalog"]), select(["support"])] });
  const result = await h.answerBmsPresales("ขอข้อมูลทั้งหมด ราคาเท่าไร", CTX);
  assert.ok(result.reply.length < 5000);
  assert.match(result.reply, /ยังมีหัวข้อที่ตอบไม่ครบ/);
});
