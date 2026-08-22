// =============================================================
// เทิร์นที่โมเดลไม่คืน text block เลย ต้องไม่เงียบ
// -------------------------------------------------------------
// เคสจริงบน production 2026-08-19 (ร้านยา, LINE): ลูกค้าถามขอตัวอย่างการสั่งหลายรายการ
// บอทยกตัวอย่างให้ ลูกค้าก็อปตัวอย่างนั้นกลับมาเป๊ะ แล้วได้คำตอบว่า "ช่วยพิมพ์ใหม่อีกครั้ง"
// ต้นเหตุ: รอบที่ 2 ของ tool loop ถูกตัดที่ max_tokens กลาง tool_use → content ไม่มี text
// block → reply = "" → usage ถูกปิดเป็น "completed" → ไม่มีใครรู้ว่าตะกร้าลูกค้าหายทั้งใบ
//
// ชุดนี้ไม่ต่อ network และไม่ต่อ DB (ใช้ test seam __toolLoopTest เหมือน runtime-contract)
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import {
  __toolLoopTest,
  type ToolLoopOptions,
  type ToolLoopTestDeps,
} from "../../apps/web/lib/bms/tools/runtime.ts";
import { stripMarkdownEmphasis } from "../../apps/web/lib/bms/requestedItems.ts";
import { parseRequestedItems } from "../../apps/web/lib/bms/requestedItems.ts";
import { deriveAiTurnQuality } from "../../apps/web/lib/bms/aiQuality.ts";
import type { BmsTool, ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";

const CREDS = {
  apiKey: "eval-key-never-sent",
  model: "deepseek-v4-flash",
  provider: "deepseek" as const,
  baseUrl: "https://api.deepseek.com/anthropic",
  source: "byok" as const,
  usageEventId: "eval-usage",
};

/** ข้อความจริงที่ลูกค้าส่งมา (ก็อปตัวอย่างของบอทมาทั้ง `**`) */
const REAL_CUSTOMER_MESSAGE =
  "**พาราเซตามอล 500 มก. ไซซ์ 10 เม็ด 5 แผง, พาราเซตามอล 500 มก. ไซซ์ 100 เม็ด 2 กล่อง, ยาแก้ท้องอืด โดมเพอริโดน ไซซ์ 10 เม็ด 3 กล่อง**";

type Events = {
  usage: Array<{ id: string; payload: any }>;
  failures: Array<{ code: string; meta: any }>;
};

function baseOptions(surface: "customer" | "staff" = "customer"): ToolLoopOptions {
  return {
    tenantId: "tenant-eval",
    system: "eval system",
    messages: [{ role: "user", content: REAL_CUSTOMER_MESSAGE }],
    tools: [],
    execCtx: {
      tenantId: "tenant-eval",
      surface,
      actor: "ai:eval",
      channel: "line",
      customerRef: "EVAL-EMPTY-REPLY",
    } as ExecCtx,
  };
}

function depsFor(
  provider: ToolLoopTestDeps["callProvider"],
  events: Events
): ToolLoopTestDeps {
  return {
    resolveCredentials: async () => CREDS,
    callProvider: provider,
    recordProviderAttempt: async () => undefined,
    auditAttempt: async () => undefined,
    finalizeUsage: async (id: string, payload: any) => {
      events.usage.push({ id, payload });
    },
    reportFailure: async (input: any) => {
      events.failures.push({ code: input?.code, meta: input?.meta });
    },
  };
}

function newEvents(): Events {
  return { usage: [], failures: [] };
}

/** ถูกตัดกลาง tool_use: มี tool_use ที่ JSON ยังไม่จบ และไม่มี text block เลย */
function truncatedMidToolUse() {
  return {
    stop_reason: "max_tokens",
    content: [{ type: "tool_use", id: "t1", name: "check_stock", input: { product: "พาราเซตามอ" } }],
    usage: { input_tokens: 4200, output_tokens: 4096 },
  };
}

function textResponse(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

test("เทิร์นที่ถูกตัดกลาง tool_use ต้องติดธง systemFailure ไม่ใช่คืน reply ว่างเฉย ๆ", async () => {
  const events = newEvents();
  const result = await __toolLoopTest.run(
    baseOptions(),
    depsFor(async () => truncatedMidToolUse(), events)
  );
  assert.equal(result.usedAi, true);
  assert.equal(result.systemFailure, "empty_reply");
  assert.equal(result.reply, "");
});

test("usage event ต้องถูกปิดเป็น fallback พร้อมเหตุผล ไม่ใช่ completed", async () => {
  const events = newEvents();
  await __toolLoopTest.run(baseOptions(), depsFor(async () => truncatedMidToolUse(), events));
  assert.equal(events.usage.length, 1);
  assert.equal(events.usage[0].payload.status, "fallback");
  assert.match(events.usage[0].payload.errorMessage, /empty_model_reply/);
  // stop_reason ต้องไปโผล่ในเหตุผล ไม่งั้นไล่ย้อนหลังไม่ได้เลย (ของจริงไม่มีที่ไหนบันทึกค่านี้)
  assert.match(events.usage[0].payload.errorMessage, /stop_reason=max_tokens/);
});

test("ต้องแจ้ง ai.empty_reply ให้ร้านรู้ พร้อมบริบทที่ไล่ปัญหาต่อได้", async () => {
  const events = newEvents();
  await __toolLoopTest.run(baseOptions(), depsFor(async () => truncatedMidToolUse(), events));
  assert.equal(events.failures.length, 1);
  assert.equal(events.failures[0].code, "ai.empty_reply");
  assert.equal(events.failures[0].meta.stopReason, "max_tokens");
  assert.equal(events.failures[0].meta.toolUseBlocks, 1);
  // เพดานที่ใช้จริงต้องถูกบันทึกไว้ ไม่งั้นเถียงกันไม่จบว่าตัดเพราะเพดานไหน
  assert.equal(events.failures[0].meta.maxTokens, 4096);
});

test("customer surface ต้องได้เพดาน output สูงกว่า staff (ตะกร้าไทยหลายรายการยาวกว่า)", async () => {
  const seen: number[] = [];
  const record = async (
    _c: unknown,
    _s: unknown,
    _m: unknown,
    _t: unknown,
    maxTokens?: number
  ) => {
    seen.push(Number(maxTokens));
    return textResponse("ok");
  };
  await __toolLoopTest.run(baseOptions("customer"), depsFor(record as any, newEvents()));
  await __toolLoopTest.run(baseOptions("staff"), depsFor(record as any, newEvents()));
  assert.deepEqual(seen, [4096, 1024]);
  assert.ok(seen[0] > 1024, "เพดานเดิม 1024 คือค่าที่ทำให้เคส production พัง");
});

test("เทิร์นที่มี text ปกติต้องไม่ถูกกระทบ (ยังปิดเป็น completed)", async () => {
  const events = newEvents();
  const result = await __toolLoopTest.run(
    baseOptions(),
    depsFor(async () => textResponse("สวัสดีค่ะ"), events)
  );
  assert.equal(result.reply, "สวัสดีค่ะ");
  assert.equal(result.systemFailure, undefined);
  assert.equal(events.usage[0].payload.status, "completed");
  assert.equal(events.failures.length, 0);
});

test("markdown ที่ลูกค้าก็อปกลับมาต้องถูกตัด แต่ 3*3 ของสินค้าต้องไม่ถูกแตะ", () => {
  assert.equal(
    stripMarkdownEmphasis("**พาราเซตามอล 500 มก.**"),
    "พาราเซตามอล 500 มก."
  );
  assert.equal(stripMarkdownEmphasis("*ยาแดง* 1 ขวด"), "ยาแดง 1 ขวด");
  // ผ้าก๊อซขายกันด้วยขนาด 3*3 นิ้ว — ตัด * ทิ้งคือเปลี่ยนสินค้าที่ลูกค้าขอ
  assert.equal(stripMarkdownEmphasis("ผ้าก๊อซ 3*3 นิ้ว 2 ห่อ"), "ผ้าก๊อซ 3*3 นิ้ว 2 ห่อ");
  assert.equal(stripMarkdownEmphasis("พลาสเตอร์ 5*7 ซม."), "พลาสเตอร์ 5*7 ซม.");
});

test("nameHint ของทุกรายการต้องไม่มี * ติดไปเป็น keyword ค้นสินค้า", () => {
  const items = parseRequestedItems(REAL_CUSTOMER_MESSAGE);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.ok(!item.nameHint.includes("*"), `nameHint ยังมี asterisk: ${item.nameHint}`);
  }
  assert.equal(items[0].nameHint, "พาราเซตามอล 500 มก. ไซซ์ 10 เม็ด");
  assert.equal(items[2].nameHint, "ยาแก้ท้องอืด โดมเพอริโดน ไซซ์ 10 เม็ด");
  // จำนวน/หน่วยต้องยังถูกเหมือนเดิม (การตัด markdown ต้องไม่กระทบการนับ)
  assert.deepEqual(
    items.map((i) => [i.qty, i.unit]),
    [[5, "แผง"], [2, "กล่อง"], [3, "กล่อง"]]
  );
});

test("ข้อความระบบพังต้องถูกจัดเป็น FAILURE ไม่ใช่ UNRESOLVED", () => {
  const systemDown = deriveAiTurnQuality({
    tool: "ai:tool-calling",
    reply:
      "ขออภัยค่ะ ระบบขัดข้องชั่วคราวจึงยังไม่ได้ดำเนินการให้ ข้อความของคุณถูกบันทึกไว้แล้ว ทางร้านจะติดต่อกลับโดยเร็วที่สุดนะคะ 🙏",
    trace: [],
  });
  assert.equal(systemDown.outcome, "FAILURE");
  assert.ok(systemDown.reasonCodes.includes("SYSTEM_ERROR"));

  // เทิร์นที่ถามกลับเรื่องธุรกิจจริงต้องยังเป็น CLARIFICATION เหมือนเดิม
  const asking = deriveAiTurnQuality({
    tool: "ai:tool-calling",
    reply: "รับไซซ์ไหนดีคะ",
    trace: [],
  });
  assert.equal(asking.outcome, "CLARIFICATION");
});
