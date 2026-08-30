import assert from "node:assert/strict";
import test from "node:test";

import { understand } from "../../apps/web/lib/bms/nlu.ts";
import { estimateAiCostUsd } from "../../apps/web/lib/bms/aiUsage.ts";
import { __toolLoopTest, type ToolLoopOptions, type ToolLoopTestDeps } from "../../apps/web/lib/bms/tools/runtime.ts";
import {
  assertValidToolRegistry,
  optInt,
  reqString,
  type BmsTool,
  type ExecCtx,
} from "../../apps/web/lib/bms/tools/types.ts";

const CREDS = {
  apiKey: "eval-key-never-sent",
  model: "claude-sonnet-4-5-20250929",
  provider: "anthropic" as const,
  baseUrl: "https://api.anthropic.com",
  source: "byok" as const,
  usageEventId: "eval-usage",
};

const DEEPSEEK_SHARED_CREDS = {
  apiKey: "eval-deepseek-key-never-sent",
  model: "deepseek-chat",
  provider: "deepseek" as const,
  baseUrl: "https://api.deepseek.com/anthropic",
  source: "shared" as const,
  usageEventId: "eval-usage",
};

test("small provider costs retain sub-micro-dollar precision", () => {
  assert.equal(estimateAiCostUsd(1, 0, "qwen-vl-ocr", "qwen"), 0.00000004);
});

test("provider rate cards are model-specific and unknown models are not guessed", () => {
  assert.equal(
    estimateAiCostUsd(1_000_000, 1_000_000, "claude-haiku-4-5-20251001", "anthropic"),
    6
  );
  assert.equal(
    estimateAiCostUsd(1_000_000, 1_000_000, "claude-opus-4-5-20251101", "anthropic"),
    30
  );
  assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, "future-model", "anthropic"), 0);
});

function textResponse(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 3, output_tokens: 2 },
  };
}

function toolResponse(name: string, input: unknown, id = "tool-1") {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
    usage: { input_tokens: 5, output_tokens: 4 },
  };
}

function makeTool(
  overrides: Partial<BmsTool> & Pick<BmsTool, "name">
): BmsTool {
  return {
    name: overrides.name,
    description: overrides.description ?? "eval tool",
    inputSchema: overrides.inputSchema ?? { type: "object", properties: {} },
    surfaces: overrides.surfaces ?? ["customer"],
    permission: overrides.permission,
    sensitive: overrides.sensitive,
    fallbackReply: overrides.fallbackReply,
    execute: overrides.execute ?? (async () => ({ ok: true, data: { ok: true } })),
  };
}

function baseOptions(tools: BmsTool[] = []): ToolLoopOptions {
  return {
    tenantId: "tenant-eval",
    system: "eval system",
    messages: [{ role: "user", content: "hello" }],
    tools,
    execCtx: {
      tenantId: "tenant-eval",
      surface: "customer",
      actor: "ai:eval",
      channel: "web",
      customerRef: "EVAL-CONTRACT",
    },
  };
}

test("tool registry validation accepts a well-formed registry", () => {
  assert.doesNotThrow(() =>
    assertValidToolRegistry([
      makeTool({ name: "read_order", surfaces: ["customer", "staff"] }),
      makeTool({ name: "cancel_order", surfaces: ["staff"], sensitive: true }),
    ])
  );
});

test("tool registry validation rejects duplicate, unsafe, and incomplete definitions", () => {
  assert.throws(
    () => assertValidToolRegistry([makeTool({ name: "read_order" }), makeTool({ name: "read_order" })]),
    /duplicate name/
  );
  assert.throws(
    () => assertValidToolRegistry([makeTool({ name: "refund_payment", surfaces: ["customer"], sensitive: true })]),
    /staff-only/
  );
  assert.throws(
    () =>
      assertValidToolRegistry([
        makeTool({
          name: "create_order",
          inputSchema: { type: "object", properties: {}, required: ["items"] },
        }),
      ]),
    /required field is undeclared/
  );
});

function depsFor(
  provider: ToolLoopTestDeps["callProvider"],
  events: {
    audits?: Array<{ name: string; outcome: string; tool?: string }>;
    usage?: Array<{ id: string; payload: unknown }>;
    attempts?: string[];
  } = {}
): ToolLoopTestDeps {
  return {
    resolveCredentials: async () => CREDS,
    callProvider: provider,
    recordProviderAttempt: async (id: string) => {
      events.attempts?.push(id);
    },
    auditAttempt: async (_ctx: ExecCtx, name: string, outcome: any, tool?: BmsTool) => {
      events.audits?.push({ name, outcome, tool: tool?.name });
    },
    finalizeUsage: async (id: string, payload: any) => {
      events.usage?.push({ id, payload });
    },
    reportFailure: async () => undefined,
  };
}

test("natural Thai quantity words are parsed for colloquial orders", () => {
  assert.equal(understand("เอาเสื้อไซ XL อันนึง").entities.qty, 1);
  assert.equal(understand("ขอสองชิ้น").entities.qty, 2);
  assert.equal(understand("เอา 3 แทนนะ").entities.qty, 3);
});

test("natural quantity updates remain order intent", () => {
  const result = understand("เปลี่ยนจำนวนเป็น 2 แทนนะ");
  assert.equal(result.intent, "CONFIRM_ORDER");
  assert.equal(result.entities.qty, 2);
  assert.equal(understand("ขอ 2 แทนนะ").intent, "CONFIRM_ORDER");
});

test("no credentials returns deterministic-fallback signal without contacting provider", async () => {
  let providerCalls = 0;
  const result = await __toolLoopTest.run(baseOptions(), {
    resolveCredentials: async () => null,
    callProvider: async () => {
      providerCalls += 1;
      return textResponse("must not run");
    },
  });
  assert.equal(result.usedAi, false);
  assert.equal(result.reply, "");
  assert.equal(providerCalls, 0);
});

test("plain provider response is returned and usage is finalized", async () => {
  const usage: Array<{ id: string; payload: any }> = [];
  const result = await __toolLoopTest.run(
    baseOptions(),
    depsFor(async () => textResponse("สวัสดีค่ะ"), { usage })
  );
  assert.equal(result.usedAi, true);
  assert.equal(result.reply, "สวัสดีค่ะ");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].payload.status, "completed");
  assert.equal(usage[0].payload.inputTokens, 3);
});

test("bounded usage diagnostics are attached when credentials are reserved", async () => {
  let receivedMeta: Record<string, unknown> | undefined;
  await __toolLoopTest.run(
    { ...baseOptions(), usageMeta: { history_compressed: true, history_messages_sent: 8 } },
    {
      ...depsFor(async () => textResponse("เรียบร้อยค่ะ")),
      resolveCredentials: async (_tenantId, context) => {
        receivedMeta = context.meta;
        return CREDS;
      },
    }
  );
  assert.equal(receivedMeta?.history_compressed, true);
  assert.equal(receivedMeta?.history_messages_sent, 8);
});

test("staff sensitive intent marks provider routing as sensitive", async () => {
  let receivedMeta: Record<string, unknown> | undefined;
  const options = baseOptions([
    makeTool({
      name: "refund_payment",
      surfaces: ["staff"],
      sensitive: true,
      execute: async () => ({
        ok: true,
        proposal: {
          tool: "refund_payment",
          mutation: "bmsRefundPayment",
          args: { id: "payment-1" },
          summary: "คืนเงิน payment-1",
        },
      }),
    }),
  ]);
  options.execCtx = {
    tenantId: "tenant-eval",
    surface: "staff",
    actor: "admin@example.com",
    ctx: {},
  };
  options.messages = [{ role: "user", content: "ช่วยคืนเงิน payment นี้ให้หน่อย" }];

  await __toolLoopTest.run(options, {
    ...depsFor(async () => textResponse("พร้อมค่ะ")),
    resolveCredentials: async (_tenantId, context) => {
      receivedMeta = context.meta;
      return CREDS;
    },
  });

  assert.equal(receivedMeta?.sensitive, true);
});

test("read-only staff intent stays on the primary provider even when sensitive tools are available", async () => {
  let receivedMeta: Record<string, unknown> | undefined;
  const options = baseOptions([
    makeTool({
      name: "refund_payment",
      surfaces: ["staff"],
      sensitive: true,
    }),
    makeTool({
      name: "list_payments",
      surfaces: ["staff"],
    }),
  ]);
  options.execCtx = {
    tenantId: "tenant-eval",
    surface: "staff",
    actor: "admin@example.com",
    ctx: {},
  };
  options.messages = [{ role: "user", content: "ขอดูรายการชำระเงินล่าสุด" }];

  await __toolLoopTest.run(options, {
    ...depsFor(async () => textResponse("เรียบร้อยค่ะ")),
    resolveCredentials: async (_tenantId, context) => {
      receivedMeta = context.meta;
      return CREDS;
    },
  });

  assert.equal(receivedMeta?.sensitive, false);
});

test("provider request marks stable tools and system for prompt caching", async () => {
  const tool = makeTool({ name: "read_product" });
  await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async (_creds, system, _messages, tools) => {
      assert.ok(Array.isArray(system));
      assert.deepEqual(system[0]?.cache_control, { type: "ephemeral" });
      assert.equal(system[0]?.text, "eval system");
      assert.deepEqual(tools.at(-1)?.cache_control, { type: "ephemeral" });
      return textResponse("เรียบร้อยค่ะ");
    })
  );
});

test("runtime marks metered usage from an unknown fallback model as unpriced", async () => {
  const usage: Array<{ id: string; payload: any }> = [];
  await __toolLoopTest.run(baseOptions(), {
    ...depsFor(async () => textResponse("เรียบร้อยค่ะ"), { usage }),
    resolveCredentials: async () => ({ ...CREDS, model: "future-model" }),
  });
  assert.equal(usage[0]?.payload.costRateKnown, false);
  assert.equal(usage[0]?.payload.estimatedCost, 0);
});

test("customer DeepSeek requests disable default thinking without changing staff requests", () => {
  const customer = __toolLoopTest.providerRequestBody(
    DEEPSEEK_SHARED_CREDS,
    "system",
    [{ role: "user", content: "hello" }],
    [],
    512,
    "customer"
  );
  const staff = __toolLoopTest.providerRequestBody(
    DEEPSEEK_SHARED_CREDS,
    "system",
    [{ role: "user", content: "hello" }],
    [],
    512,
    "staff"
  );
  assert.deepEqual(customer.thinking, { type: "disabled" });
  assert.equal(staff.thinking, undefined);
});

test("shared DeepSeek timeout falls back once before tools under the same usage event", async () => {
  const attempts: string[] = [];
  const usage: Array<{ id: string; payload: any }> = [];
  const providers: string[] = [];
  const result = await __toolLoopTest.run(baseOptions(), {
    ...depsFor(async (creds) => {
      providers.push(creds.provider);
      if (creds.provider === "deepseek") {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      return textResponse("สำเร็จผ่านระบบสำรองค่ะ");
    }, { attempts, usage }),
    resolveCredentials: async () => DEEPSEEK_SHARED_CREDS,
    resolveFallbackCredentials: async (primary) => ({
      ...CREDS,
      source: "shared",
      usageEventId: primary.usageEventId,
    }),
  });

  assert.equal(result.reply, "สำเร็จผ่านระบบสำรองค่ะ");
  assert.deepEqual(providers, ["deepseek", "anthropic"]);
  assert.deepEqual(attempts, ["eval-usage", "eval-usage"]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.payload.providerCalls, 2);
  assert.equal(usage[0]?.payload.unpricedProviderCalls, 1);
  assert.equal(usage[0]?.payload.meta.runtime_fallback_used, true);
  assert.equal(usage[0]?.payload.meta.providers_attempted, "deepseek,anthropic");
  assert.deepEqual(
    usage[0]?.payload.providerOutcomes.map((item: any) => [item.provider, item.status]),
    [["deepseek", "failed"], ["anthropic", "completed"]]
  );
});

test("registry-only tool metadata never reaches the provider payload", async () => {
  // feat/function-registry (8480aeba) added these fields to BmsTool for docs/humans only — they
  // must never be serialized into the Anthropic tool schema, or every turn silently starts paying
  // token cost for them. This guards the invariant runtime.ts's serialization block currently
  // upholds by hand-picking name/description/input_schema; it would catch a future refactor that
  // spreads `...tool` instead.
  const documentedTool: BmsTool = {
    name: "documented_tool",
    description: "eval tool with registry-only metadata",
    whenToUse: "must never leak into the provider payload",
    whenNotToUse: "must never leak into the provider payload",
    commonMistakes: ["must never leak into the provider payload"],
    example: { input: {}, note: "must never leak into the provider payload" },
    fallbackReply: () => "must never leak into the provider payload",
    inputSchema: { type: "object", properties: {} },
    surfaces: ["customer"],
    execute: async () => ({ ok: true }),
  };
  let seenTools: Array<Record<string, unknown>> = [];
  await __toolLoopTest.run(
    baseOptions([documentedTool]),
    depsFor(async (_creds, _system, _messages, tools) => {
      seenTools = tools;
      return textResponse("เรียบร้อยค่ะ");
    })
  );
  assert.equal(seenTools.length, 1);
  const keys = Object.keys(seenTools[0]);
  for (const forbidden of ["whenToUse", "whenNotToUse", "commonMistakes", "example", "fallbackReply"]) {
    assert.ok(!keys.includes(forbidden), `"${forbidden}" must not be serialized into the provider tool schema`);
  }
  // ยืนยันบวก ไม่ใช่แค่ปฏิเสธ 4 field ที่รู้ชื่อไว้ก่อน — เผื่อมี field registry-only ใหม่ในอนาคต
  // ที่ยังไม่มีใครเขียนชื่อไว้ในลิสต์ข้างบน
  assert.deepEqual(new Set(keys), new Set(["name", "description", "input_schema", "cache_control"]));
});

test("per-conversation slot memory is sent after the cache breakpoint, never inside the cached prefix", async () => {
  // ถ้า slot memory ถูกต่อเข้าไปใน system block ที่ 1 (ก้อนที่มี cache_control) prefix
  // tools+system จะเปลี่ยนทุกครั้งที่ลูกค้าพิมพ์ → cache ใช้ซ้ำไม่ได้เลย และเสีย cache write 1.25x
  await __toolLoopTest.run(
    { ...baseOptions([makeTool({ name: "read_product" })]), volatileSystem: '{"size":"XL"}' },
    depsFor(async (_creds, system, _messages, _tools) => {
      assert.ok(Array.isArray(system));
      assert.equal(system.length, 2);
      assert.equal(system[0]?.text, "eval system");
      assert.deepEqual(system[0]?.cache_control, { type: "ephemeral" });
      assert.equal(system[1]?.text, '{"size":"XL"}');
      assert.equal(system[1]?.cache_control, undefined);
      return textResponse("เรียบร้อยค่ะ");
    })
  );
  // ไม่มี slot memory = ไม่ต้องมี block ที่ 2 (prefix สั้นที่สุดเท่าที่เป็นไปได้)
  await __toolLoopTest.run(
    { ...baseOptions([makeTool({ name: "read_product" })]), volatileSystem: "   " },
    depsFor(async (_creds, system) => {
      assert.equal(system.length, 1);
      return textResponse("เรียบร้อยค่ะ");
    })
  );
});

test("cached usage stores total input tokens and cache-adjusted estimated cost", async () => {
  const usage: Array<{ id: string; payload: any }> = [];
  await __toolLoopTest.run(
    baseOptions(),
    depsFor(
      async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "เรียบร้อยค่ะ" }],
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
          output_tokens: 10,
        },
      }),
      { usage }
    )
  );
  assert.equal(usage[0]?.payload.inputTokens, 600);
  assert.equal(usage[0]?.payload.outputTokens, 10);
  assert.equal(usage[0]?.payload.providerCalls, 1);
  assert.equal(usage[0]?.payload.unpricedProviderCalls, 0);
  assert.equal(usage[0]?.payload.costMeasured, true);
  assert.equal(usage[0]?.payload.estimatedCost, 0.00129);
  // breakdown ต้องไหลไปถึง finalizer ด้วย ไม่ใช่แค่ถูกใช้คิด cost แล้วทิ้ง — เพราะคอลัมน์
  // input_tokens เป็นผลรวม จึงบอกไม่ได้ว่า prompt cache hit จริงไหมถ้าไม่มีสองค่านี้
  assert.equal(usage[0]?.payload.cacheReadInputTokens, 300);
  assert.equal(usage[0]?.payload.cacheCreationInputTokens, 200);
});

test("usage breakdown is reported as zero, not omitted, when a cache breakpoint is sent but never hits", async () => {
  // แยก "ตั้ง cache_control แล้วไม่ hit" (0) ออกจาก "path นี้ไม่ได้ตั้ง cache_control เลย" (ไม่มี key)
  // — ถ้ารายงานเป็น undefined ทั้งสองกรณี จะแยกไม่ออกว่า caching ตายเงียบหรือไม่เคยเปิด
  const usage: Array<{ id: string; payload: any }> = [];
  await __toolLoopTest.run(
    baseOptions(),
    depsFor(
      async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "เรียบร้อยค่ะ" }],
        usage: { input_tokens: 4130, output_tokens: 10 },
      }),
      { usage }
    )
  );
  assert.equal(usage[0]?.payload.inputTokens, 4130);
  assert.equal(usage[0]?.payload.cacheReadInputTokens, 0);
  assert.equal(usage[0]?.payload.cacheCreationInputTokens, 0);
});

test("malformed provider content is bounded and returned as an empty safe result for caller fallback wording", async () => {
  const usage: Array<{ id: string; payload: any }> = [];
  const result = await __toolLoopTest.run(
    baseOptions(),
    depsFor(async () => ({
      stop_reason: "end_turn",
      content: { unexpected: true },
      usage: { input_tokens: "not-a-number", output_tokens: null },
    }), { usage })
  );
  assert.equal(result.usedAi, true);
  assert.equal(result.reply, "");
  assert.deepEqual(result.trace, []);
  assert.equal(usage[0]?.payload.inputTokens, 0);
  assert.equal(usage[0]?.payload.outputTokens, 0);
  assert.equal(usage[0]?.payload.providerCalls, 1);
  assert.equal(usage[0]?.payload.unpricedProviderCalls, 1);
  assert.equal(usage[0]?.payload.costMeasured, false);
});

test("verified tool data replaces a token-truncated provider reply with a bounded server fallback", async () => {
  let call = 0;
  const tool = makeTool({
    name: "read_history",
    fallbackReply: (data) => `verified:${(data as any).count}:ask show more`,
    execute: async () => ({ ok: true, data: { count: 5 } }),
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      call += 1;
      return call === 1
        ? toolResponse("read_history", {})
        : {
            stop_reason: "max_tokens",
            content: [{ type: "text", text: "| # | Order ID |\n|---|---|\n| 1" }],
            usage: { input_tokens: 4, output_tokens: 1 },
          };
    })
  );
  assert.equal(result.reply, "verified:5:ask show more");
  assert.equal(result.systemFailure, "empty_reply");
  assert.equal(result.trace[0]?.tool, "read_history");
});

test("partial provider usage keeps known cost while flagging the call as unpriced", async () => {
  const usage: Array<{ id: string; payload: any }> = [];
  await __toolLoopTest.run(
    baseOptions(),
    depsFor(
      async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "เรียบร้อยค่ะ" }],
        usage: { input_tokens: 100 },
      }),
      { usage }
    )
  );

  assert.equal(usage[0]?.payload.providerCalls, 1);
  assert.equal(usage[0]?.payload.unpricedProviderCalls, 1);
  assert.equal(usage[0]?.payload.costMeasured, true);
  assert.equal(usage[0]?.payload.estimatedCost, 0.0003);
});

test("unknown tool is rejected, audited, and returned to the model as an error", async () => {
  const audits: Array<{ name: string; outcome: string }> = [];
  let round = 0;
  const result = await __toolLoopTest.run(
    baseOptions(),
    depsFor(async (_creds, _system, messages) => {
      round += 1;
      if (round === 1) return toolResponse("drop_database", {});
      const last = messages.at(-1)?.content?.[0]?.content ?? "";
      assert.match(last, /ไม่รู้จักทูล/);
      return textResponse("ทำรายการนี้ไม่ได้ค่ะ");
    }, { audits })
  );
  assert.equal(result.trace[0]?.tool, "drop_database");
  assert.equal(result.trace[0]?.ok, false);
  assert.deepEqual(audits, [{ name: "drop_database", outcome: "unknown", tool: undefined }]);
});

test("unknown input fields are rejected before tool execution", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "read_product",
    inputSchema: { type: "object", properties: { sku: { type: "string" } } },
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      return round === 1
        ? toolResponse("read_product", { sku: "SKU-1", tenantId: "other-tenant" })
        : textResponse("ไม่สำเร็จ");
    })
  );
  assert.equal(executions, 0);
  assert.equal(result.trace[0]?.ok, false);
  assert.match(result.trace[0]?.summary ?? "", /ไม่รองรับ field: tenantId/);
});

test("model-supplied limits are clamped to the declared maximum, not rejected", () => {
  // เกินเพดาน = clamp (ไม่ throw) เพราะการทำให้ทูลล้มเหลวจะเสีย turn ไปกับการ retry
  // ส่วน tool_result ที่ใหญ่เกินจะอยู่ใน context ทุกรอบถัดไปและไม่ถูก prompt cache
  assert.equal(optInt({ limit: 10_000 }, "limit", 1, 20), 20);
  assert.equal(optInt({ limit: 20 }, "limit", 1, 20), 20);
  assert.equal(optInt({ limit: 5 }, "limit", 1, 20), 5);
  // ไม่ระบุ max = พฤติกรรมเดิม ไม่มีเพดาน
  assert.equal(optInt({ limit: 10_000 }, "limit"), 10_000);
  // ขาล่างยัง throw เหมือนเดิม (ไม่ clamp) และค่าที่ไม่ได้ส่งมายังเป็น undefined
  assert.throws(() => optInt({ limit: 0 }, "limit", 1, 20), /จำนวนเต็ม/);
  assert.equal(optInt({}, "limit", 1, 20), undefined);
});

test("non-object tool input is rejected before tool execution", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "read_product",
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("read_product", "SKU-1") : textResponse("ไม่สำเร็จ");
    })
  );
  assert.equal(executions, 0);
  assert.match(result.trace[0]?.summary ?? "", /input ของทูลต้องเป็น object/);
});

test("tool argument validation errors are safe and do not leak stack traces", async () => {
  let round = 0;
  const tool = makeTool({
    name: "get_product",
    inputSchema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
    execute: async (args) => {
      reqString(args, "sku");
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("get_product", {}) : textResponse("กรุณาระบุสินค้า");
    })
  );
  assert.equal(result.trace[0]?.ok, false);
  assert.match(result.trace[0]?.summary ?? "", /ต้องระบุ "sku"/);
  assert.doesNotMatch(result.trace[0]?.summary ?? "", /at\s+\w+/);
});

test("customer surface cannot execute a staff-only tool", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "staff_report",
    surfaces: ["staff"],
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("staff_report", {}) : textResponse("ไม่มีสิทธิ์");
    })
  );
  assert.equal(executions, 0);
  assert.match(result.trace[0]?.summary ?? "", /customer surface ไม่ได้/);
});

test("customer surface cannot execute a sensitive tool", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "refund_payment",
    surfaces: ["customer", "staff"],
    sensitive: true,
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("refund_payment", {}) : textResponse("ต้องให้แอดมินช่วยค่ะ");
    })
  );
  assert.equal(executions, 0);
  assert.match(result.trace[0]?.summary ?? "", /ลูกค้าเรียกทูลที่ต้องยืนยันไม่ได้/);
});

test("staff permission is enforced again immediately before execution", async () => {
  let executions = 0;
  let round = 0;
  const audits: Array<{ name: string; outcome: string }> = [];
  const tool = makeTool({
    name: "create_order",
    surfaces: ["staff"],
    permission: "order.create",
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const options = baseOptions([tool]);
  options.execCtx = {
    tenantId: "tenant-eval",
    surface: "staff",
    actor: "viewer@example.com",
    ctx: {
      admin: { id: "viewer", role: "Viewer" },
      __bmsPerms: new Set(),
    },
  };
  const result = await __toolLoopTest.run(
    options,
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("create_order", {}) : textResponse("ไม่มีสิทธิ์");
    }, { audits })
  );
  assert.equal(executions, 0);
  assert.match(result.trace[0]?.summary ?? "", /ไม่มีสิทธิ์ order\.create/);
  assert.equal(audits[0]?.outcome, "denied");
});

test("staff tool executes when the cached request context contains its permission", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "read_orders",
    surfaces: ["staff"],
    permission: "order.view",
    execute: async () => {
      executions += 1;
      return { ok: true, data: { orders: [] } };
    },
  });
  const options = baseOptions([tool]);
  options.execCtx = {
    tenantId: "tenant-eval",
    surface: "staff",
    actor: "viewer@example.com",
    ctx: {
      admin: { id: "viewer", role: "Viewer" },
      __bmsPerms: new Set(["order.view"]),
    },
  };
  const result = await __toolLoopTest.run(
    options,
    depsFor(async () => {
      round += 1;
      return round === 1 ? toolResponse("read_orders", {}) : textResponse("ไม่พบออร์เดอร์");
    })
  );
  assert.equal(executions, 1);
  assert.equal(result.trace[0]?.ok, true);
});

test("sensitive staff tool can only produce a proposal, never execute the action", async () => {
  let round = 0;
  const tool = makeTool({
    name: "refund_payment",
    surfaces: ["staff"],
    sensitive: true,
    execute: async () => ({
      ok: true,
      proposal: {
        tool: "refund_payment",
        mutation: "bmsRefundPayment",
        args: { id: "payment-1" },
        summary: "คืนเงิน payment-1",
      },
    }),
  });
  const options = baseOptions([tool]);
  options.execCtx = {
    tenantId: "tenant-eval",
    surface: "staff",
    actor: "admin@example.com",
    ctx: {},
  };
  const result = await __toolLoopTest.run(
    options,
    depsFor(async (_creds, _system, messages) => {
      round += 1;
      if (round === 1) return toolResponse("refund_payment", {});
      assert.match(messages.at(-1)?.content?.[0]?.content ?? "", /PENDING_CONFIRMATION/);
      return textResponse("เตรียมคำขอแล้ว รอยืนยันค่ะ");
    })
  );
  assert.equal(result.proposals.length, 1);
  assert.match(result.trace[0]?.summary ?? "", /^proposal:/);
});

test("non-sensitive tools returning proposals are rejected", async () => {
  let round = 0;
  const tool = makeTool({
    name: "unsafe_shape",
    execute: async () => ({
      ok: true,
      proposal: {
        tool: "unsafe_shape",
        mutation: "unexpectedMutation",
        args: {},
        summary: "unexpected",
      },
    }),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await __toolLoopTest.run(
      baseOptions([tool]),
      depsFor(async () => {
        round += 1;
        return round === 1 ? toolResponse("unsafe_shape", {}) : textResponse("ไม่สำเร็จ");
      })
    );
    assert.equal(result.proposals.length, 0);
    assert.equal(result.trace[0]?.ok, false);
  } finally {
    console.error = originalError;
  }
});

test("provider outage after a write never invokes the write twice or signals fallback", async () => {
  let writes = 0;
  let round = 0;
  let fallbackResolutions = 0;
  const tool = makeTool({
    name: "create_order",
    inputSchema: { type: "object", properties: { sku: { type: "string" } } },
    execute: async () => {
      writes += 1;
      return { ok: true, data: { status: "CREATED", orderId: "order-1" } };
    },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await __toolLoopTest.run(
      baseOptions([tool]),
      {
        ...depsFor(async () => {
          round += 1;
          if (round === 1) return toolResponse("create_order", { sku: "SKU-1" });
          const error = new Error("simulated timeout");
          error.name = "AbortError";
          throw error;
        }),
        resolveCredentials: async () => DEEPSEEK_SHARED_CREDS,
        resolveFallbackCredentials: async () => {
          fallbackResolutions += 1;
          return { ...CREDS, source: "shared" };
        },
      }
    );
    assert.equal(writes, 1);
    assert.equal(fallbackResolutions, 0);
    assert.equal(result.usedAi, true);
    assert.match(result.reply, /ระบบขัดข้องชั่วคราว/);
  } finally {
    console.error = originalError;
  }
});

test("provider outage before any tool call returns a safe retry response", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await __toolLoopTest.run(
      baseOptions(),
      depsFor(async () => {
        const error = new Error("Claude API 429");
        error.name = "AbortError";
        throw error;
      })
    );
    assert.equal(result.usedAi, true);
    assert.equal(result.trace.length, 0);
    assert.match(result.reply, /ระบบขัดข้องชั่วคราว/);
  } finally {
    console.error = originalError;
  }
});

test("repeated successful tool call with identical arguments is replayed without duplicate write", async () => {
  let writes = 0;
  let round = 0;
  const audits: Array<{ name: string; outcome: string }> = [];
  const tool = makeTool({
    name: "create_order",
    inputSchema: {
      type: "object",
      properties: { sku: { type: "string" }, qty: { type: "integer" } },
    },
    execute: async () => {
      writes += 1;
      return { ok: true, data: { status: "CREATED", orderId: "order-1" } };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      if (round === 1) return toolResponse("create_order", { sku: "SKU-1", qty: 1 }, "tool-1");
      if (round === 2) return toolResponse("create_order", { qty: 1, sku: "SKU-1" }, "tool-2");
      return textResponse("รับออร์เดอร์แล้ว");
    }, { audits })
  );
  assert.equal(writes, 1);
  assert.equal(result.trace.length, 2);
  assert.match(result.trace[1]?.summary ?? "", /duplicate suppressed/);
  assert.equal(audits.length, 2, "ทุก attempt ยังต้อง audit แม้ execution ถูก deduplicate");
});

test("customer create_order with different arguments is still limited to one write per logical turn", async () => {
  let writes = 0;
  let round = 0;
  const tool = makeTool({
    name: "create_order",
    inputSchema: {
      type: "object",
      properties: { sku: { type: "string" }, qty: { type: "integer" } },
    },
    execute: async (_args, ec) => {
      writes += 1;
      ec.createdOrderId = "order-1";
      return { ok: true, data: { status: "CREATED", orderId: "order-1" } };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      if (round === 1) return toolResponse("create_order", { sku: "SKU-1", qty: 1 }, "tool-1");
      if (round === 2) return toolResponse("create_order", { sku: "SKU-2", qty: 1 }, "tool-2");
      return textResponse("รับออร์เดอร์แล้ว");
    })
  );
  assert.equal(writes, 1);
  assert.equal(result.trace.length, 2);
  assert.match(result.trace[1]?.summary ?? "", /ออร์เดอร์ถูกสร้างแล้ว/);
});

test("failed tool calls are not cached so the same arguments can recover from a transient error", async () => {
  let executions = 0;
  let round = 0;
  const tool = makeTool({
    name: "transient_read",
    execute: async () => {
      executions += 1;
      return executions === 1
        ? { ok: false, error: "temporary unavailable" }
        : { ok: true, data: { recovered: true } };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(async () => {
      round += 1;
      if (round <= 2) return toolResponse("transient_read", {}, `tool-${round}`);
      return textResponse("กลับมาใช้งานได้แล้ว");
    })
  );
  assert.equal(executions, 2);
  assert.equal(result.trace[0]?.ok, false);
  assert.equal(result.trace[1]?.ok, true);
  assert.doesNotMatch(result.trace[1]?.summary ?? "", /duplicate suppressed/);
});

test("max-round loop is bounded to five tool executions", async () => {
  let executions = 0;
  let providerCalls = 0;
  const usage: Array<{ id: string; payload: any }> = [];
  const attempts: string[] = [];
  const tool = makeTool({
    name: "read_loop",
    inputSchema: {
      type: "object",
      properties: { round: { type: "integer" } },
    },
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.run(
    baseOptions([tool]),
    depsFor(
      async () => {
        providerCalls += 1;
        return toolResponse("read_loop", { round: providerCalls }, `tool-${providerCalls}`);
      },
      { usage, attempts }
    )
  );
  assert.equal(providerCalls, 5);
  assert.equal(executions, 5);
  assert.equal(result.trace.length, 5);
  assert.equal(usage[0]?.payload.providerCalls, 5);
  assert.equal(attempts.length, 5);
  assert.match(result.reply, /ประมวลผลนานเกินไป/);
});

test("tenant mismatch and duplicate registry fail before credential resolution", async () => {
  let credentialCalls = 0;
  const deps: ToolLoopTestDeps = {
    resolveCredentials: async () => {
      credentialCalls += 1;
      return CREDS;
    },
  };
  const mismatch = baseOptions();
  mismatch.execCtx.tenantId = "tenant-other";
  await assert.rejects(__toolLoopTest.run(mismatch, deps), /tenant context mismatch/);

  const duplicate = makeTool({ name: "same_name" });
  await assert.rejects(
    __toolLoopTest.run(baseOptions([duplicate, duplicate]), deps),
    /duplicate names/
  );
  assert.equal(credentialCalls, 0);
});

test("audit seam receives only redacted attempt metadata, never raw tool input", async () => {
  const calls: any[][] = [];
  let round = 0;
  const tool = makeTool({
    name: "lookup",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  });
  await __toolLoopTest.run(baseOptions([tool]), {
    resolveCredentials: async () => CREDS,
    callProvider: async () => {
      round += 1;
      return round === 1
        ? toolResponse("lookup", { query: "secret@example.com" })
        : textResponse("เรียบร้อย");
    },
    auditAttempt: async (...args: any[]) => {
      calls.push(args);
    },
    recordProviderAttempt: async () => {},
    finalizeUsage: async () => {},
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 4);
  assert.equal(calls[0][1], "lookup");
  assert.equal(calls[0][2], "ok");
  assert.doesNotMatch(JSON.stringify(calls), /secret@example\.com/);
});

test("server-selected approved tool uses the same validation, execution, trace, and audit boundary", async () => {
  const audits: Array<{ name: string; outcome: string }> = [];
  let executions = 0;
  const tool = makeTool({
    name: "get_order_status",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      executions += 1;
      return { ok: true, data: { orders: [] } };
    },
  });
  const result = await __toolLoopTest.runApproved(
    { tool, input: {}, execCtx: baseOptions().execCtx },
    {
      auditAttempt: async (_ctx, name, outcome) => {
        audits.push({ name, outcome });
      },
    }
  );
  assert.equal(executions, 1);
  assert.equal(result.result.ok, true);
  assert.deepEqual(result.trace, {
    tool: "get_order_status",
    input: {},
    ok: true,
    summary: "ok",
  });
  assert.deepEqual(audits, [{ name: "get_order_status", outcome: "ok" }]);
});

test("server-selected approved tool rejects unknown fields before execution", async () => {
  let executions = 0;
  const tool = makeTool({
    name: "submit_payment",
    inputSchema: {
      type: "object",
      properties: { method: { type: "string" } },
    },
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.runApproved(
    {
      tool,
      input: { method: "QR", tenantId: "tenant-other" },
      execCtx: baseOptions().execCtx,
    },
    { auditAttempt: async () => {} }
  );
  assert.equal(executions, 0);
  assert.equal(result.result.ok, false);
  assert.match(result.trace.summary, /ไม่รองรับ field: tenantId/);
});

test("server-selected approved tool cannot bypass customer sensitive-action denial", async () => {
  let executions = 0;
  const tool = makeTool({
    name: "refund_payment",
    surfaces: ["customer", "staff"],
    sensitive: true,
    execute: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const result = await __toolLoopTest.runApproved(
    { tool, input: {}, execCtx: baseOptions().execCtx },
    { auditAttempt: async () => {} }
  );
  assert.equal(executions, 0);
  assert.equal(result.result.ok, false);
  assert.match(result.trace.summary, /ลูกค้าเรียกทูลที่ต้องยืนยันไม่ได้/);
});
