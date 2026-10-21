import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  composePresalesKnowledgeReply,
  isBmsPlanQuestion,
  searchBmsPresalesKnowledge,
} from "../../apps/web/lib/bms/platformPresales.ts";
import { BMS_LINE_OA_ID, isBmsLineOfficialAccount } from "../../apps/web/lib/bms/lineOfficialAccount.ts";
import { customerTools } from "../../apps/web/lib/bms/tools/catalog.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { PRESALES_QUESTIONS } from "./bms-presales-question-corpus.mts";

test("250-question fallback corpus retrieves every required public topic", () => {
  assert.equal(PRESALES_QUESTIONS.length, 250);
  const failures = PRESALES_QUESTIONS.flatMap(([query, expected], index) => {
    const ids = searchBmsPresalesKnowledge(query, "th", 5).map(entry => entry.id);
    const missing = expected.split("|").filter(id => !ids.includes(id));
    return missing.length ? [`${index + 1}. ${query}: missing ${missing.join(",")} (got ${ids.join(",")})`] : [];
  });
  assert.deepEqual(failures, []);
});

test("common BMS prospect questions retrieve the intended verified topic", () => {
  for (const [query, expected] of [
    ["BMS คืออะไร", "overview"],
    ["ระบบ BMS ครบหรือ ยัง", "readiness-status"],
    ["มีอะไรยังไม่พร้อม production บ้าง", "readiness-status"],
    ["สร้างร้านอะไรได้บ้าง", "business-types"],
    ["ต่อ GrabFood ได้ไหม", "delivery-integrations"],
    ["AI ยืนยันสลิปเองไหม", "security"],
    ["มีระบบคิดค่าเล่นตามเวลาสำหรับร้านบอร์ดเกมไหม", "board-game"],
  ] as const) {
    assert.equal(searchBmsPresalesKnowledge(query, "th", 3)[0]?.id, expected, query);
  }
});

test("readiness questions get an explicit bounded status answer", () => {
  for (const query of ["ครบหรือยัง", "พร้อมใช้จริงไหม", "อะไรยังไม่เสร็จ", "is BMS production ready?"]) {
    const result = searchBmsPresalesKnowledge(query, /[ก-๙]/.test(query) ? "th" : "en", 1);
    assert.equal(result[0]?.id, "readiness-status", query);
    const reply = composePresalesKnowledgeReply(result, /[ก-๙]/.test(query) ? "th" : "en");
    assert.match(reply, /(?:ไม่ควรถูกอธิบายว่าเสร็จครบ 100%|not be described as 100% complete)/i, query);
  }
});

test("business-type and product wording does not get mistaken for the Business or Pro plan", () => {
  assert.equal(isBmsPlanQuestion("What business types and products does BMS support?"), false);
  assert.equal(isBmsPlanQuestion("How much is the Business plan?"), true);
  assert.equal(isBmsPlanQuestion("แพ็กเกจ Pro ราคาเท่าไร"), true);
});

test("public presales copy stays customer-safe and admits current limitations", () => {
  const result = searchBmsPresalesKnowledge("GrabFood LINE MAN foodpanda", "th", 1);
  const reply = composePresalesKnowledgeReply(result, "th");
  assert.match(reply, /ยังห้ามสัญญา|ยังติดข้อกำหนด/);
  assert.doesNotMatch(reply, /\/admin\/|permission|migration|bms_tenant/i);
});

test("presales mode exposes only public BMS tools while shop mode retains commerce tools", () => {
  const presales = customerTools(undefined, "bms_presales").map(tool => tool.name).sort();
  assert.deepEqual(presales, ["list_bms_public_plans", "search_bms_presales"]);
  assert.equal(customerTools().some(tool => tool.name === "search_bms_presales"), false);
  assert.equal(customerTools().some(tool => tool.name === "browse_catalog"), true);
  assert.equal(presales.includes("browse_catalog"), false);
  assert.equal(presales.includes("create_order"), false);
});

test("runtime denies crossing the server-selected customer-mode boundary", async () => {
  const presalesTool = customerTools(undefined, "bms_presales").find(tool => tool.name === "search_bms_presales")!;
  const denied = await __toolLoopTest.runApproved({
    tool: presalesTool,
    input: { query: "BMS คืออะไร", locale: "th" },
    execCtx: { tenantId: "FAKE", surface: "customer", actor: "ai:test", customerMode: "shop_commerce" },
  }, { auditAttempt: async () => {}, reportFailure: async () => {} });
  assert.equal(denied.result.ok, false);
  assert.match((denied.result as { error: string }).error, /customer mode/);
});

test("public topic selection rejects bad inputs and caller-controlled scope, with locale fixed by context", async () => {
  const tool = customerTools(undefined, "bms_presales").find(t => t.name === "search_bms_presales")!;
  const ec = { tenantId: "FAKE", surface: "customer" as const, actor: "ai:test", customerMode: "bms_presales" as const, locale: "en" as const };
  const deps = { auditAttempt: async () => {}, reportFailure: async () => {} };
  for (const input of [
    { query: "" }, { query: "x".repeat(2001) }, { query: "x", tenantId: "other" },
    { query: "x", topicIds: ["overview"], limit: 0 }, { query: "x", topicIds: "overview" },
    { query: "x", topicIds: [null] }, { query: "x", locale: "untrusted" },
  ]) {
    const result = await __toolLoopTest.runApproved({ tool, input, execCtx: ec }, deps);
    assert.equal(result.result.ok, false, JSON.stringify(input));
  }
  const valid = await __toolLoopTest.runApproved({ tool, input: { query: "BMS", topicIds: ["overview"], locale: "th" }, execCtx: ec }, deps);
  assert.equal(valid.result.ok, true);
  assert.match(JSON.stringify(valid.result), /business operating system/);
  const commerce = customerTools().find(t => t.name === "browse_catalog")!;
  assert.equal((await __toolLoopTest.runApproved({ tool: commerce, input: {}, execCtx: ec }, deps)).result.ok, false);
});

test("BMS LINE identity requires provider-synced metadata and the exact public Basic ID", () => {
  assert.equal(isBmsLineOfficialAccount({ botBasicId: BMS_LINE_OA_ID }), false);
  assert.equal(isBmsLineOfficialAccount({ botBasicId: BMS_LINE_OA_ID, botInfoSyncedAt: "2026-10-21T00:00:00Z" }), true);
  assert.equal(isBmsLineOfficialAccount({ botBasicId: "@another", botInfoSyncedAt: "2026-10-21T00:00:00Z" }), false);
});

test("LINE webhook derives the mode from bot identity and passes it to the shared pipeline", () => {
  const source = readFileSync(new URL("../../apps/web/app/api/bms/line/webhook/[tenantId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /isBmsLineOfficialAccount\(processingCfg\.extra\)/);
  assert.match(source, /runPipeline\(text, "line", tenantId, userId, \{ assistantMode \}\)/);
  assert.doesNotMatch(source, /assistantMode\s*=\s*(?:body|req|ev|message)/);
  const channels = readFileSync(new URL("../../apps/web/lib/bms/channels.ts", import.meta.url), "utf8");
  assert.match(channels, /channel === "line"/);
  assert.match(channels, /lineChannelExtra\(prev\?\.extra, input\.extra, tokenChanged\)/);
});

test("public pricing tool reads the authoritative plan service instead of embedding prices", () => {
  const source = readFileSync(new URL("../../apps/web/lib/bms/platformPresales.ts", import.meta.url), "utf8");
  assert.match(source, /const plans = await listPlans\(\)/);
  assert.doesNotMatch(source, /price_monthly:\s*\d/);
});
