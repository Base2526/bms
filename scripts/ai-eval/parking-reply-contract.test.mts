import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { customerStoreFacts, customerStoreMessages, replyWithoutQuotedStoreFacts, answersWithStoreFacts } from "../../apps/web/lib/bms/customerStoreContext.ts";
import { customerParkingFallback, answersWithParkingFacts, isParkingQuestion, needsParkingClarification, scopeParkingFactsForReply } from "../../apps/web/lib/bms/customerParkingReply.ts";
import type { ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const pipeline = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("pipeline.ts", pipeline, ts.ScriptTarget.Latest, true);
const nodes: any[] = [];
function visit(n: any) { nodes.push(n); ts.forEachChild(n, visit); }
visit(tree);
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const declaration = (name: string) => nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === name);
const detector = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "hasUnverifiedFacts");
const detectorSource = ["PRICE_PATTERN", "STOCK_PATTERN", "PRICE_FACT_TOOLS", "STOCK_FACT_TOOLS"]
  .map(name => `const ${declaration(name).getText(tree)};`).join("\n") + detector.getText(tree);
const guard = nodes.find(n => ts.isIfStatement(n) && n.expression.getText(tree).includes("hasUnverifiedFacts(replyWithoutQuotedStoreFacts"));
const parkingGuard = nodes.find(n => ts.isIfStatement(n) && n.expression.getText(tree).startsWith("needsParkingClarification("));

/** Run the actual pipeline guard condition/body, not a second implementation of its decision. */
function finalReply(modelReply: string, incoming: string, ec: ExecCtx, english = false) {
  const latestStoreFacts = ec.customerStoreRead!.facts;
  const parkingLookupBranch = ec.customerStoreRead?.branch;
  const vars = { latestStoreFacts, parkingLookupBranch, aiInputMessage: incoming, englishReply: english,
    replyStoreFacts: scopeParkingFactsForReply(latestStoreFacts, incoming, parkingLookupBranch),
    loop: { reply: modelReply, trace: [] }, replyWithoutQuotedStoreFacts, customerParkingFallback, needsParkingClarification };
  return new Function(...Object.keys(vars), compile(`${detectorSource}; let reply = loop.reply;
    if (${parkingGuard.expression.getText(tree)}) ${parkingGuard.thenStatement.getText(tree)}
    else if (${guard.expression.getText(tree)}) ${guard.thenStatement.getText(tree)}; return reply;`))(...Object.values(vars));
}
const parking = { status: "AVAILABLE", carSpaces: 10, motorcycleSpaces: 0,
  details: "ทางเข้าด้านหลัง ค่าจอด 20 บาทต่อชั่วโมง ฟรีเมื่อประทับตรา 2 ชั่วโมงแรก", mapUrl: "https://example.test/parking" };
const data = (branches = [{ name: "FAKE A", parking }], truncated = false) => ({ storeName: "FAKE Shop", branchParking: { branches, truncated } });
const context = (value: any, branch: string | null = null): ExecCtx => ({ tenantId: "FAKE-TENANT", actor: "ai:customer", surface: "customer",
  customerStoreRead: { facts: customerStoreFacts({ ok: true, data: value }), branch } });

test("the real final-reply guard repairs abbreviated parking fees without asking for a product", () => {
  for (const businessArchetype of ["restaurant", "board_game_cafe", "retail"]) {
    const ec = context({ ...data(), businessArchetype });
    const reply = finalReply("ค่าจอด 20 บาทต่อชั่วโมงค่ะ", "ค่าจอดเท่าไร", ec);
    assert.match(reply, /20 บาทต่อชั่วโมง ฟรีเมื่อประทับตรา 2 ชั่วโมงแรก/);
    assert.match(reply, /รถยนต์ทั้งหมด 10 ช่อง/);
    assert.match(reply, /มอเตอร์ไซค์ทั้งหมด 0 ช่อง/);
    assert.match(reply, /ยังไม่ทราบจำนวนช่องว่าง/);
    assert.doesNotMatch(reply, /ชื่อสินค้า|ไซซ์|999/);
    const mixed = finalReply("ค่าจอด 20 บาท และกาแฟ 999 บาท", "ค่าจอดเท่าไร กาแฟราคาเท่าไร", ec);
    assert.doesNotMatch(mixed, /999/);
    assert.match(mixed, /รายละเอียดอื่นที่ไม่ได้ระบุยังยืนยันไม่ได้/);
    assert.match(finalReply("สินค้า 999 บาท", "กาแฟราคาเท่าไร", ec), /สินค้า\/ไซซ์/);
    assert.doesNotMatch(finalReply("ค่าจอด 900 บาท", "ค่าจอดเท่าไร", context({ ...data(), about: "ค่าจอด 900 บาท" })), /900/);
  }
});

test("fallback never chooses an ambiguous, guessed, missing or truncated branch", () => {
  const ec = context(data([{ name: "FAKE A", parking }, { name: "FAKE B", parking: { ...parking, details: "SECRET OTHER FEE 900 บาท" } }]));
  assert.match(finalReply("ค่าจอด 900 บาท", "ค่าจอดเท่าไร", ec), /สาขาไหน/);
  assert.doesNotMatch(finalReply("ค่าจอด 900 บาท", "ค่าจอดเท่าไร", ec), /SECRET/);
  assert.match(finalReply("ค่าจอด 900 บาท", "ค่าจอด FAKE A เท่าไร", ec), /20 บาท/);
  const guessed = context(data(), "FAKE A");
  assert.match(finalReply("ค่าจอด 20 บาท", "มีที่จอดรถไหม", guessed), /สาขาไหน/);
  assert.match(finalReply("มีที่จอดรถฟรีค่ะ", "มีที่จอดรถไหม", guessed), /สาขาไหน/);
  assert.match(finalReply("ค่าจอด 20 บาท", "ค่าจอดสาขาที่ไม่อยู่ในรายการเท่าไร", context(data())), /สาขาไหน/);
  const truncated = context(data([{ name: "FAKE A", parking }], true));
  assert.match(finalReply("ค่าจอด 20 บาท", "ค่าจอด FAKE A เท่าไร", truncated), /สาขาไหน/);
  const scoped = scopeParkingFactsForReply(ec.customerStoreRead!.facts, "ค่าจอด FAKE A เท่าไร");
  assert.match(replyWithoutQuotedStoreFacts("SECRET OTHER FEE 900 บาท", scoped), /900 บาท/);
});

test("hidden, unknown and no parking stay distinct, including on failed latest reads", () => {
  for (const [value, expected] of [
    [null, /ยังไม่ได้เปิดเผย/],
    [{ status: "UNKNOWN", carSpaces: null, motorcycleSpaces: null, details: null, mapUrl: null }, /ยังไม่ระบุ/],
    [{ status: "NONE", carSpaces: null, motorcycleSpaces: null, details: "ลานภายนอกร้าน", mapUrl: null }, /ไม่มีที่จอดรถของร้าน/],
  ] as const) {
    assert.match(finalReply("ค่าจอด 20 บาท", "ค่าจอดเท่าไร", context(data([{ name: "FAKE A", parking: value as any }]))), expected);
  }
  const privateShape = customerStoreFacts({ ok: true, data: data([{ name: "FAKE A", parking: { ...parking, published: false } as any }]) });
  assert.equal(privateShape.branchParking?.branches[0].parking, null);
  assert.match(finalReply("มีที่จอดรถฟรีค่ะ", "มีที่จอดรถไหม", context(data([{ name: "FAKE A", parking: null as any }]))), /ยังไม่ได้เปิดเผย/);
  const ec = context(data()); ec.customerStoreRead!.facts = customerStoreFacts({ ok: false, error: "PRIVATE DB ERROR" });
  assert.match(finalReply("Parking costs 20 baht", "How much is parking?", ec, true), /could not verify/);
  assert.doesNotMatch(finalReply("Parking costs 20 baht", "How much is parking?", ec, true), /PRIVATE|20/);
  assert.match(finalReply("Parking is provided.", "Is there parking?", ec, true), /could not verify/);
});

test("a grounded parking status counts as progress, but prefetch alone or another branch does not", () => {
  const ec = context(data()); const facts = ec.customerStoreRead!.facts;
  assert.equal(answersWithParkingFacts("มีที่จอดรถค่ะ รองรับรถยนต์ 10 คัน", facts, "มีที่จอดรถไหม"), true);
  assert.equal(answersWithParkingFacts("Parking is provided.", facts, "Is there parking?"), true);
  assert.equal(answersWithParkingFacts("ไม่มีที่จอดรถค่ะ", facts, "มีที่จอดรถไหม"), false);
  assert.equal(answersWithParkingFacts("มีที่จอดรถค่ะ", facts, "มีที่จอดรถไหม", "FAKE A"), false);
  assert.equal(answersWithStoreFacts("ช่วยถามอีกครั้งค่ะ", facts), false);
  assert.equal(isParkingQuestion("ส่งกาแฟที่จอดรถด้านหลัง"), false);
  assert.equal(isParkingQuestion("deliver coffee to the car park"), false);
  assert.match(pipeline, /answersWithParkingFacts\(reply, latestStoreFacts, aiInputMessage, parkingLookupBranch\)/);
  assert.match(pipeline, /reply: customerParkingFallback\(latestStoreFacts/);
});

test("real store tool and runtime replace prefetched facts with each fresh branch read", async t => {
  const globals = globalThis as any; const previous = globals.__bmsPostgresPool;
  const envNames = ["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "PHARMACY_INTAKE_ENABLED", "PHARMACY_PROTOCOLS_ENABLED"];
  const previousEnv = envNames.map(name => process.env[name]);
  for (const name of envNames) delete process.env[name];
  let published = true; let failRead = false; let reads = 0;
  let profile = { business_archetype: "restaurant", ai_language: "th" };
  const sql: any[] = [];
  const query = async (text: string, params: any[] = []) => {
    sql.push({ text, params }); let rows: any[] = [];
    if (text.includes("FROM bms_store_profile")) rows = [profile];
    else if (text.includes("SELECT id FROM bms_conversations")) rows = [{ id: "FAKE-conversation" }];
    else if (text.includes("FROM bms_ai_usage_monthly")) rows = [{ credits_granted: 0 }];
    else if (text.includes("INSERT INTO bms_ai_usage_events")) rows = [{ id: "FAKE-usage-event" }];
    else if (text.includes("FROM bms_tenants")) rows = [{ name: "FAKE Shop" }];
    else if (text.includes("to_jsonb(location)")) {
      reads++; if (failRead) throw new Error("FAKE read failure");
      rows = [{ name: params[1] ?? "FAKE A", parking_info: { ...parking, published } }];
    }
    return { rows, rowCount: rows.length };
  };
  globals.__bmsPostgresPool = { query, connect: async () => ({ query, release() {} }) };
  t.mock.method(console, "error", () => {});
  try {
    const { sharedRedisClient } = await import("../../apps/web/lib/cache.ts");
    t.mock.method(sharedRedisClient, "get", async () => null);
    t.mock.method(sharedRedisClient, "set", async () => "OK");
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
    const { __toolLoopTest } = await import("../../apps/web/lib/bms/tools/runtime.ts");
    const { ALL_TOOLS } = await import("../../apps/web/lib/bms/tools/catalog.ts");
    const tool = ALL_TOOLS.find(tool => tool.name === "get_store_info")!;
    const ec: ExecCtx = { tenantId: "FAKE-TENANT", actor: "ai:customer", surface: "customer" };
    const audits: string[] = []; let providerCalls = 0;
    const deps: any = {
      auditAttempt: async (_ec: any, name: string, outcome: string) => { audits.push(`${name}:${outcome}`); },
      reportFailure: async () => {}, recordProviderAttempt: async () => {}, finalizeUsage: async () => {},
      resolveCredentials: async () => ({ apiKey: "FAKE", model: "FAKE", provider: "anthropic", source: "byok", baseUrl: "https://example.test" }),
      callProvider: async (_creds: any, _system: any, messages: any[]) => {
        providerCalls++;
        if (providerCalls === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "read-1", name: "get_store_info", input: { branch: "FAKE B" } }] };
        if (providerCalls === 2) {
          assert.equal(JSON.parse(messages.at(-1).content[0].content).branchParking.branches[0].name, "FAKE B");
          published = false;
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "read-2", name: "get_store_info", input: { branch: "FAKE B" } }] };
        }
        assert.equal(JSON.parse(messages.at(-1).content[0].content).branchParking.branches[0].parking, null);
        return { stop_reason: "end_turn", content: [{ type: "text", text: "ค่าจอด 20 บาท" }] };
      },
    };
    const prefetch = await __toolLoopTest.runApproved({ tool, input: {}, execCtx: ec }, deps);
    assert.equal(ec.customerStoreRead!.facts.branchParking!.branches[0].parking!.carSpaces, 10);
    const loop = await __toolLoopTest.run({ tenantId: ec.tenantId, system: "FAKE test", messages: [
      { role: "user", content: "ค่าจอด FAKE B เท่าไร" }, ...customerStoreMessages(customerStoreFacts(prefetch.result)),
    ], tools: [tool], execCtx: ec }, deps);
    assert.equal(reads, 3, "repeated store reads must not replay earlier publication");
    assert.equal(ec.customerStoreRead!.branch, "FAKE B");
    assert.match(finalReply(loop.reply, "ค่าจอด FAKE B เท่าไร", ec), /ยังไม่ได้เปิดเผย/);
    assert.equal(audits.filter(entry => entry === "get_store_info:ok").length, 3);
    failRead = true;
    const failure = await __toolLoopTest.runApproved({ tool, input: {}, execCtx: ec }, deps);
    assert.equal(failure.result.ok, false);
    assert.equal(ec.customerStoreRead!.facts.status, "unavailable");
    assert.match(finalReply("ค่าจอด 20 บาท", "ค่าจอด FAKE B เท่าไร", ec), /ตรวจสอบข้อมูลที่จอดรถไม่ได้/);
    failRead = false; published = true;
    await __toolLoopTest.runApproved({ tool, input: {}, execCtx: ec }, deps);
    let invalidRounds = 0;
    await __toolLoopTest.run({ tenantId: ec.tenantId, system: "FAKE", messages: [], tools: [tool], execCtx: ec }, {
      ...deps, callProvider: async () => ++invalidRounds === 1
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "invalid-read", name: "get_store_info", input: { tenantId: "OTHER" } }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "ค่าจอด 20 บาท" }] },
    });
    assert.equal(ec.customerStoreRead!.facts.status, "unavailable", "failed model-selected reads invalidate prefetch too");

    const { runPipeline } = await import("../../apps/web/lib/bms/pipeline.ts");
    for (const archetype of ["restaurant", "board_game_cafe", "retail"]) {
      for (const language of ["th", "en"]) {
        profile = { business_archetype: archetype, ai_language: language };
        const answer = await runPipeline(language === "th" ? "มีที่จอดรถไหม ค่าจอดเท่าไร" : "Is there parking? How much does it cost?", "web", ec.tenantId, "FAKE-customer");
        assert.equal(answer.tool, "deterministic:get_store_info", `${archetype}/${language}`);
        assert.match(answer.reply, language === "th" ? /มีที่จอดรถ/ : /Parking is provided/);
        assert.match(answer.reply, /20 บาทต่อชั่วโมง ฟรีเมื่อประทับตรา 2 ชั่วโมงแรก/);
        assert.doesNotMatch(answer.reply, /สินค้า\/ไซซ์|product and size/);
      }
    }
    assert.equal(network.mock.callCount(), 0);
    assert.ok(sql.filter(call => call.text.includes("to_jsonb(location)")).every(call => call.params[0] === "FAKE-TENANT"));
  } finally {
    globals.__bmsPostgresPool = previous;
    envNames.forEach((name, i) => { if (previousEnv[i] === undefined) delete process.env[name]; else process.env[name] = previousEnv[i]; });
  }
});
