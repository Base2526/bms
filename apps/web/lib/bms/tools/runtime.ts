// =============================================================
// BMS AI Tools — provider-neutral tool-use runtime (Anthropic-compatible)
// -------------------------------------------------------------
// วน: model → (tool_use) → validate+execute service → tool_result → จนได้ text
// - bounded: MAX_ROUNDS + timeout ต่อ call (ตาม AI_GUIDELINES § Reliability)
// - ทูล sensitive (A3) คืน proposal → ไม่ execute, ป้อนกลับว่า "รอมนุษย์ยืนยัน"
// - ไม่มี credentials (ไม่มี key/เกิน quota) → usedAi:false ให้ caller fallback
// - provider call ล้มเหลวหลังเริ่ม loop → usedAi:true + safe error (ไม่ fallback ไป write ซ้ำ)
// =============================================================

import {
  resolveAiCredentials,
  resolveAiRuntimeFallbackCredentials,
  type AiCredentials,
} from "../ai";
import { callAnthropicCompatibleMessages } from "../aiProvider";
import {
  estimateCachedAiCostUsd,
  finalizeAiUsageEvent,
  hasAiCostRate,
  recordAiProviderAttempt,
} from "../aiUsage";
import { audit } from "../audit";
import { reportBmsFailure, type BmsFailureCode } from "../failureAlert";
import { requirePermission } from "../permissions";
import {
  ToolArgError,
  type BmsTool,
  type ExecCtx,
  type ToolProposal,
  type ToolResult,
  type ToolSurface,
} from "./types";

export type ToolTraceEntry = {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
};

export type ToolLoopResult = {
  reply: string;
  proposals: ToolProposal[];
  trace: ToolTraceEntry[];
  /** false = ไม่มี AI credentials → caller ต้อง fallback (rule-based/template) */
  usedAi: boolean;
  /**
   * ตั้งเมื่อลูปทำงานจนจบแต่ **ไม่ได้คำตอบที่ใช้ได้** — caller ต้องบอกลูกค้าว่าระบบขัดข้อง
   * ห้ามบอกให้ลูกค้าพิมพ์ใหม่ (ลูกค้าพิมพ์ถูกแล้ว ความผิดอยู่ที่ระบบ) และห้ามเดินเส้นทาง
   * rule-based ที่อาจ write ซ้ำ — `usedAi` ยังเป็น true อยู่เหมือนเดิม
   */
  systemFailure?: "empty_reply";
};

type AnthMessage = { role: "user" | "assistant"; content: any };
type AnthCacheControl = { type: "ephemeral" };
type AnthSystemBlock = {
  type: "text";
  text: string;
  cache_control?: AnthCacheControl;
};
type AnthToolSchema = {
  name: string;
  description: string;
  input_schema: unknown;
  cache_control?: AnthCacheControl;
};

const MAX_ROUNDS = 5;
const TIMEOUT_MS = 20_000;
/**
 * เพดาน output ต่อรอบ **ต่อ surface** — ไม่ใช่เป้า จ่ายตามที่ generate จริงเท่านั้น
 *
 * customer เคยใช้ 1024 ร่วมกับ staff แล้วพังจริงบน production (2026-08-19): prompt
 * ของฝั่งลูกค้าสั่งให้ยิงทูล "ทุกรายการในรอบเดียว" แล้วสรุปยืนยันทุกบรรทัดเป็นภาษาไทย
 * ซึ่งกินโทเคนแพงกว่าอังกฤษหลายเท่า ตะกร้า 3 รายการจึงชนเพดานกลาง tool_use → เทิร์นนั้น
 * ไม่มี text block เลย → ลูกค้าได้ "ช่วยพิมพ์ใหม่" ทั้งที่พิมพ์ถูก
 *
 * ห้ามลดค่าฝั่ง customer กลับไปต่ำกว่านี้โดยไม่แก้ prompt ที่ pipeline.ts ก่อน
 * (ถ้าชนอีก จะไม่เงียบแล้ว — ดู ai.empty_reply)
 */
const MAX_TOKENS_BY_SURFACE: Readonly<Record<ToolSurface, number>> = {
  customer: 4096,
  staff: 1024,
};

function maxTokensForSurface(surface: ToolSurface): number {
  return MAX_TOKENS_BY_SURFACE[surface] ?? 1024;
}
const EPHEMERAL_CACHE_CONTROL: AnthCacheControl = { type: "ephemeral" };

class ToolAccessError extends Error {}

/**
 * แจ้งเตือนความล้มเหลวที่ "ไม่คาดคิด" เท่านั้น
 *
 * สำคัญ: ห้าม hook จาก outcome ของ auditAttempt ตรง ๆ แม้จะเป็นจุดที่ทูลทุกตัวไหล
 * ผ่านจริง เพราะ outcome "error" รวม 3 กรณีที่ต่างกันสิ้นเชิงไว้ด้วยกัน —
 *   (1) ทูล throw exception จริง (DB/schema/network พัง)      ← อันนี้ควรแจ้ง
 *   (2) ToolArgError จาก args ที่ model ส่งมาผิด (model retry เองได้)
 *   (3) ทูลคืน { ok:false } ตามเหตุผลทางธุรกิจ เช่น "ไม่พบสินค้า"
 * ถ้าแจ้งจาก outcome จะกลายเป็น noise ทุกครั้งที่ลูกค้าถามหาสินค้าที่ร้านไม่มี
 * จึงเรียกจากจุดเดียวกับที่โค้ดเดิม console.error อยู่แล้ว ซึ่งกรองไว้ถูกแล้ว
 */
function reportToolFailure(
  report: typeof reportBmsFailure,
  code: BmsFailureCode,
  execCtx: ExecCtx,
  error: unknown,
  meta?: Record<string, unknown>
): Promise<void> {
  return report({
    tenantId: execCtx.tenantId,
    code,
    error,
    surface: execCtx.surface,
    channel: execCtx.channel ?? null,
    conversationId: execCtx.conversationId ?? null,
    customerRef: execCtx.customerRef ?? null,
    meta,
  });
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolArgError("input ของทูลต้องเป็น object");
  }
  return value as Record<string, unknown>;
}

/** JSON schema ช่วย model เลือก args; runtime ยังต้อง reject field แปลกอีกชั้น */
function validateKnownFields(tool: BmsTool, input: Record<string, unknown>): void {
  if (tool.inputSchema.additionalProperties === true) return;
  const allowed = new Set(Object.keys(tool.inputSchema.properties));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ToolArgError(`ไม่รองรับ field: ${unknown.join(", ")}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function tokenCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && typeof (block as any).text === "string"
        ? (block as any).text
        : ""
    )
    .join(" ");
}

const SENSITIVE_TOOL_INTENT: Readonly<Record<string, RegExp>> = {
  confirm_payment: /(ยืนยัน|รับยอด|confirm).*(ชำระ|จ่าย|payment)|(?:ชำระ|จ่าย|payment).*(ยืนยัน|confirm)/i,
  reject_payment: /(ปฏิเสธ|ไม่รับ|reject).*(ชำระ|จ่าย|payment|สลิป)|(?:ชำระ|payment|สลิป).*(ปฏิเสธ|reject)/i,
  refund_payment: /(คืนเงิน|refund)/i,
  cancel_order: /(ยกเลิก|cancel).*(ออเดอร์|order|คำสั่งซื้อ)/i,
  adjust_stock: /(ปรับ|แก้|เพิ่ม|ลด|adjust).*(สต็อก|stock|inventory)/i,
  merge_customers: /(รวม|merge).*(ลูกค้า|customer)/i,
  cancel_purchase_order: /(ยกเลิก|cancel).*(ใบสั่งซื้อ|purchase order|\bpo\b)/i,
  cancel_shipment: /(ยกเลิก|cancel).*(จัดส่ง|ขนส่ง|shipment)/i,
  send_customer_message: /(ส่ง|ทัก|ตอบ|message).*(ข้อความ|ลูกค้า|customer)|(?:ข้อความ|message).*(ส่ง|ลูกค้า|customer)/i,
};

/**
 * Provider routing only: authorization and propose-only enforcement still happen at tool execution.
 * Looking at the latest staff request avoids routing every read-only staff turn to the expensive
 * sensitive baseline merely because sensitive tools are available in the catalog.
 */
export function hasSensitiveStaffIntent(
  messages: AnthMessage[],
  tools: BmsTool[]
): boolean {
  const latestUserText =
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content;
  const text = messageText(latestUserText).trim();
  if (!text) return false;
  return tools.some(
    (tool) =>
      tool.sensitive === true &&
      (SENSITIVE_TOOL_INTENT[tool.name]?.test(text) ?? false)
  );
}

/**
 * ลูปนี้เคยถูกเรียกว่า "bounded" แต่คุมแค่ฝั่ง AI (MAX_ROUNDS + timeout ต่อ provider call)
 * ส่วน `tool.execute` ซึ่งไปแตะ Postgres จริงไม่มีเพดานเวลาเลย — lock contention หรือ query
 * ที่ช้าผิดปกติจึงค้าง request ได้ไม่จำกัด แล้วลูกค้าไม่ได้คำตอบและไม่มีใครรู้ว่าค้างที่ไหน
 *
 * ตั้งไว้สูงกว่า provider timeout เพราะทูลเขียน (create_order) ทำงานในทรานแซกชันที่ยาวกว่า
 * การอ่านหนึ่งครั้ง · timeout ที่นี่ **ไม่ยกเลิกงานที่ DB กำลังทำอยู่** (pg ไม่มี cancel ผ่าน
 * AbortSignal ที่ระดับนี้) — มันแค่ทำให้ลูปเดินต่อไปได้และรายงานว่าทูลไหนค้าง ทรานแซกชันที่
 * ค้างยังต้องพึ่ง statement_timeout ฝั่ง Postgres ตามปกติ
 */
const TOOL_TIMEOUT_MS = 30_000;

async function executeToolBounded(
  tool: BmsTool,
  input: Record<string, unknown>,
  ec: ExecCtx
): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.execute(input, ec),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`ทูล ${tool.name} ใช้เวลาเกิน ${TOOL_TIMEOUT_MS} ms`)),
          TOOL_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Gate ตอน execute (defense in depth): การกรอง tool schema ก่อนส่งให้ Claude อย่างเดียวไม่พอ
 * เพราะ model/provider output ถือเป็น untrusted input เสมอ
 */
async function authorizeTool(tool: BmsTool, ec: ExecCtx): Promise<void> {
  if (!tool.surfaces.includes(ec.surface)) {
    throw new ToolAccessError(`ทูล ${tool.name} ใช้กับ ${ec.surface} surface ไม่ได้`);
  }
  if (ec.surface === "customer" && tool.sensitive) {
    throw new ToolAccessError("ลูกค้าเรียกทูลที่ต้องยืนยันไม่ได้");
  }
  if (ec.surface === "staff" && tool.permission) {
    if (!ec.ctx) throw new ToolAccessError("ไม่มี staff context สำหรับตรวจสิทธิ์");
    try {
      await requirePermission(ec.ctx, tool.permission);
    } catch {
      throw new ToolAccessError(`ไม่มีสิทธิ์ ${tool.permission}`);
    }
  }
}

function assertSingleCustomerOrderWrite(tool: BmsTool, ec: ExecCtx): void {
  if (
    ec.surface === "customer" &&
    ec.createdOrderId &&
    (tool.name === "create_order" || tool.name === "reorder")
  ) {
    throw new ToolArgError(
      "ออร์เดอร์ถูกสร้างแล้วในคำขอนี้ ห้ามสร้างออร์เดอร์ซ้ำ ให้ตอบจากผลออร์เดอร์เดิม"
    );
  }
}

/** บันทึกทุก tool attempt โดยตั้งใจไม่เก็บ raw args/prompt/PII */
async function auditToolCall(
  ec: ExecCtx,
  toolName: string,
  outcome: "ok" | "error" | "denied" | "proposal" | "unknown",
  tool?: BmsTool
): Promise<void> {
  const safeName = toolName.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "unknown";
  const ctx = ec.ctx ?? { tenant_id: ec.tenantId, admin: { email: ec.actor } };
  await audit(ctx, "ai.tool_call", safeName, {
    surface: ec.surface,
    outcome,
    permission: tool?.permission ?? null,
    sensitive: Boolean(tool?.sensitive),
    channel: ec.surface === "customer" ? ec.channel ?? null : null,
  });
}

async function callProviderMessages(
  creds: AiCredentials,
  system: string | AnthSystemBlock[],
  messages: AnthMessage[],
  tools: AnthToolSchema[],
  maxTokens: number = MAX_TOKENS_BY_SURFACE.staff,
  surface: ToolSurface = "staff"
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await callAnthropicCompatibleMessages(
      creds,
      providerRequestBody(creds, system, messages, tools, maxTokens, surface),
      controller.signal
    );
    if (!resp.ok) throw new Error(`${creds.provider} API ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function providerRequestBody(
  creds: AiCredentials,
  system: string | AnthSystemBlock[],
  messages: AnthMessage[],
  tools: AnthToolSchema[],
  maxTokens: number,
  surface: ToolSurface
): Record<string, unknown> {
  return {
    model: creds.model,
    max_tokens: maxTokens,
    system,
    tools,
    messages,
    // DeepSeek's Anthropic-compatible endpoint enables thinking by default. Customer commerce
    // turns need deterministic tool selection, not a long reasoning budget that can consume the
    // whole 20-second provider deadline before returning the first tool_use.
    ...(creds.provider === "deepseek" && surface === "customer"
      ? { thinking: { type: "disabled" } }
      : {}),
  };
}

function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /\bAPI\s+(?:429|5\d\d)\b|timed?\s*out|timeout|aborted|network|fetch failed/i.test(message);
}

export type ToolLoopOptions = {
  tenantId: string;
  /** ส่วนที่ต้อง byte-identical ทุก request ของร้านเดียวกัน — เป็น prefix ที่ถูก cache */
  system: string;
  /**
   * ส่วนที่เปลี่ยนได้ทุก turn (เช่น slot memory ของบทสนทนานั้น) วางเป็น system block ที่ 2
   * หลัง cache breakpoint จึงไม่ทำให้ prefix ที่ cache ไว้ใช้ไม่ได้ — ห้ามย้ายกลับไปต่อใน `system`
   */
  volatileSystem?: string | null;
  /** Bounded, non-PII diagnostics stored on the usage event (counts/flags only). */
  usageMeta?: Record<string, string | number | boolean | null>;
  messages: AnthMessage[];
  tools: BmsTool[];
  execCtx: ExecCtx;
};

/**
 * Test-only dependency seam for deterministic contract tests.
 *
 * Production callers must use runToolLoop(), which always supplies the real credential resolver,
 * provider transport, usage finalizer, and audit writer. Keeping the seam at the function boundary
 * lets the eval suite force timeout/malformed/unknown-tool paths without exposing a diagnostic HTTP
 * endpoint or weakening any runtime authorization.
 */
export type ToolLoopTestDeps = {
  resolveCredentials?: typeof resolveAiCredentials;
  resolveFallbackCredentials?: typeof resolveAiRuntimeFallbackCredentials;
  callProvider?: typeof callProviderMessages;
  finalizeUsage?: typeof finalizeAiUsageEvent;
  recordProviderAttempt?: typeof recordAiProviderAttempt;
  auditAttempt?: typeof auditToolCall;
  /**
   * ต้องอยู่ใน seam ด้วย ไม่งั้น contract test (ที่ระบุว่าไม่ต่อ network/DB) จะแอบ
   * เขียน bms_failure_incidents จริงทุกครั้งที่ทดสอบ path ความล้มเหลว
   */
  reportFailure?: typeof reportBmsFailure;
};

export type ApprovedToolOptions = {
  tool: BmsTool;
  input?: Record<string, unknown>;
  execCtx: ExecCtx;
};

/**
 * Execute a server-selected catalog tool through the same authorization, validation, and audit
 * boundary as model-selected tool calls. This is for narrow deterministic routes where asking the
 * model to choose whether to call the tool would make a factual customer workflow unreliable.
 */
async function runApprovedToolInternal(
  opts: ApprovedToolOptions,
  deps: Pick<ToolLoopTestDeps, "auditAttempt" | "reportFailure"> = {}
): Promise<{ result: ToolResult; trace: ToolTraceEntry }> {
  const auditAttempt = deps.auditAttempt ?? auditToolCall;
  const reportFailure = deps.reportFailure ?? reportBmsFailure;
  const { tool, execCtx } = opts;
  let input: Record<string, unknown> = {};
  let outcome: "ok" | "error" | "denied" | "proposal" = "error";
  let result: ToolResult;
  let trace: ToolTraceEntry;

  try {
    await authorizeTool(tool, execCtx);
    input = inputRecord(opts.input ?? {});
    validateKnownFields(tool, input);
    assertSingleCustomerOrderWrite(tool, execCtx);
    const executed = await executeToolBounded(tool, input, execCtx);
    if (executed.ok && executed.proposal) {
      if (!tool.sensitive) throw new Error("non-sensitive tool returned a proposal");
      outcome = "proposal";
      result = executed;
      trace = {
        tool: tool.name,
        input,
        ok: true,
        summary: `proposal: ${executed.proposal.summary}`,
      };
    } else if (executed.ok) {
      if (tool.sensitive) throw new Error("sensitive tool must return a proposal");
      outcome = "ok";
      result = executed;
      trace = { tool: tool.name, input, ok: true, summary: "ok" };
    } else {
      outcome = "error";
      result = executed;
      trace = { tool: tool.name, input, ok: false, summary: executed.error };
    }
  } catch (err) {
    const denied = err instanceof ToolAccessError;
    outcome = denied ? "denied" : "error";
    const message =
      err instanceof ToolArgError || denied ? err.message : "ดึงข้อมูลไม่สำเร็จ";
    result = { ok: false, error: message };
    trace = { tool: tool.name, input, ok: false, summary: message };
    if (!(err instanceof ToolArgError) && !denied) {
      console.error(`[BMS] approved tool ${tool.name} failed:`, err);
      await reportToolFailure(reportFailure, "ai.tool_failed", execCtx, err, {
        tool: tool.name,
        route: "deterministic",
      });
    }
  }

  await auditAttempt(execCtx, tool.name, outcome, tool);
  return { result, trace };
}

async function runToolLoopInternal(
  opts: ToolLoopOptions,
  deps: ToolLoopTestDeps = {}
): Promise<ToolLoopResult> {
  const resolveCredentials = deps.resolveCredentials ?? resolveAiCredentials;
  const resolveFallbackCredentials =
    deps.resolveFallbackCredentials ?? resolveAiRuntimeFallbackCredentials;
  const callProvider = deps.callProvider ?? callProviderMessages;
  const finalizeUsage = deps.finalizeUsage ?? finalizeAiUsageEvent;
  const persistProviderAttempt = deps.recordProviderAttempt ?? recordAiProviderAttempt;
  const auditAttempt = deps.auditAttempt ?? auditToolCall;
  const reportFailure = deps.reportFailure ?? reportBmsFailure;

  if (opts.tenantId !== opts.execCtx.tenantId) {
    throw new Error("AI tool-loop tenant context mismatch");
  }
  const uniqueNames = new Set(opts.tools.map((tool) => tool.name));
  if (uniqueNames.size !== opts.tools.length) {
    throw new Error("AI tool registry contains duplicate names");
  }
  const creds = await resolveCredentials(opts.tenantId, {
    surface: opts.execCtx.surface,
    feature: opts.execCtx.surface === "staff" ? "staff_assistant" : "customer_tool_loop",
    channel: opts.execCtx.surface === "customer" ? opts.execCtx.channel ?? null : null,
    meta: {
      actor: opts.execCtx.actor,
      sensitive:
        opts.execCtx.surface === "staff" &&
        hasSensitiveStaffIntent(opts.messages, opts.tools),
      ...(opts.usageMeta ?? {}),
    },
  });
  if (!creds) return { reply: "", proposals: [], trace: [], usedAi: false };
  let activeCreds = creds;
  const attemptedProviders: string[] = [];
  let runtimeFallbackUsed = false;

  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const toolSchemas: AnthToolSchema[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      ...t.inputSchema,
      additionalProperties: t.inputSchema.additionalProperties ?? false,
    },
  }));
  // Cache tool definitions independently so per-conversation system changes do not invalidate
  // the largest stable request prefix.
  if (toolSchemas.length > 0) {
    toolSchemas[toolSchemas.length - 1] = {
      ...toolSchemas[toolSchemas.length - 1],
      cache_control: EPHEMERAL_CACHE_CONTROL,
    };
  }
  // breakpoint ที่ 2 ครอบ tools + system ให้ request ถัดไปอ่านซ้ำได้ทั้งก้อน
  // ทุกอย่างที่เปลี่ยนต่อ conversation ต้องอยู่ใน block ที่ 2 (หลัง breakpoint) เท่านั้น —
  // เพราะ cache match แบบ longest-prefix ถึง breakpoint ข้อมูลหลังจากนั้นจึงเปลี่ยนได้ฟรี
  const cachedSystem: AnthSystemBlock[] = [
    {
      type: "text",
      text: opts.system,
      cache_control: EPHEMERAL_CACHE_CONTROL,
    },
  ];
  const volatileSystem = opts.volatileSystem?.trim();
  if (volatileSystem) {
    cachedSystem.push({ type: "text", text: volatileSystem });
  }

  const proposals: ToolProposal[] = [];
  const trace: ToolTraceEntry[] = [];
  const messages: AnthMessage[] = [...opts.messages];
  // Provider อาจ retry/repeat tool_use เดิมใน loop เดียวกัน หลัง service write สำเร็จแล้ว
  // เก็บเฉพาะผลสำเร็จเพื่อ replay tool_result โดยไม่ execute domain action ซ้ำ; error ไม่ cache
  // เพื่อให้ model แก้ args/retry transient failure ได้ตามปกติ
  const completedCalls = new Map<
    string,
    {
      resultContent: string;
      outcome: "ok" | "proposal";
      summary: string;
      fallbackReply?: string | null;
    }
  >();
  let latestVerifiedFallback: string | null = null;
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;
  let providerCalls = 0;
  let pricedProviderCalls = 0;
  let hasAnyMeteredUsage = false;
  let allMeteredRatesKnown = true;
  let estimatedCost = 0;
  const providerOutcomes: Array<{
    provider: string;
    status: "completed" | "failed";
    errorMessage?: string | null;
  }> = [];

  function usagePayload() {
    return {
      inputTokens:
        inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
      // ส่ง breakdown ไปเก็บใน meta ด้วย — คอลัมน์ input_tokens เป็นผลรวมจึงบอกไม่ได้ว่า cache hit หรือไม่
      cacheCreationInputTokens,
      cacheReadInputTokens,
      outputTokens,
      providerCalls,
      unpricedProviderCalls: providerCalls - pricedProviderCalls,
      costMeasured: hasAnyMeteredUsage,
      costRateKnown: hasAnyMeteredUsage ? allMeteredRatesKnown : undefined,
      estimatedCost,
      meta: {
        providers_attempted: attemptedProviders.join(","),
        runtime_fallback_used: runtimeFallbackUsed,
      },
      providerOutcomes,
    };
  }

  // สำคัญ (write-safety): เมื่อมี credentials แล้ว ถือว่า AI "ทำงานแล้ว" (usedAi:true) เสมอ
  // แม้ provider call จะล้มกลางคัน — เพื่อไม่ให้ caller ไปรัน rule-based ที่อาจ createOrder ซ้ำ
  // หลังจากทูล create_order ทำงานไปแล้วในรอบก่อนหน้า
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let resp: any;
      while (true) {
        providerCalls += 1;
        attemptedProviders.push(activeCreds.provider);
        if (creds.usageEventId) await persistProviderAttempt(creds.usageEventId);
        try {
          resp = await callProvider(
            activeCreds,
            cachedSystem,
            messages,
            toolSchemas,
            maxTokensForSurface(opts.execCtx.surface),
            opts.execCtx.surface
          );
          providerOutcomes.push({ provider: activeCreds.provider, status: "completed" });
          break;
        } catch (err) {
          providerOutcomes.push({
            provider: activeCreds.provider,
            status: "failed",
            errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          });
          // Fail over only on the first provider attempt, before the model has selected or run any
          // tool. Once a tool result exists, changing providers could replay a write with a newly
          // generated tool_use, so the normal safe-error path must win instead.
          const canFailOver =
            providerCalls === 1 &&
            round === 0 &&
            trace.length === 0 &&
            isRetryableProviderError(err);
          const fallback = canFailOver
            ? await resolveFallbackCredentials(creds)
            : null;
          if (!fallback || fallback.provider === activeCreds.provider) throw err;
          activeCreds = fallback;
          runtimeFallbackUsed = true;
        }
      }
      if (
        Number.isFinite(resp?.usage?.input_tokens) &&
        Number.isFinite(resp?.usage?.output_tokens)
      ) {
        pricedProviderCalls += 1;
      }
      if (
        Number.isFinite(resp?.usage?.input_tokens) ||
        Number.isFinite(resp?.usage?.output_tokens)
      ) {
        hasAnyMeteredUsage = true;
        if (!hasAiCostRate(activeCreds.model, activeCreds.provider)) {
          allMeteredRatesKnown = false;
        }
      }
      inputTokens += tokenCount(resp?.usage?.input_tokens);
      cacheCreationInputTokens += tokenCount(
        resp?.usage?.cache_creation_input_tokens
      );
      cacheReadInputTokens += tokenCount(resp?.usage?.cache_read_input_tokens);
      outputTokens += tokenCount(resp?.usage?.output_tokens);
      estimatedCost += estimateCachedAiCostUsd(
        {
          inputTokens: tokenCount(resp?.usage?.input_tokens),
          cacheCreationInputTokens: tokenCount(resp?.usage?.cache_creation_input_tokens),
          cacheReadInputTokens: tokenCount(resp?.usage?.cache_read_input_tokens),
          outputTokens: tokenCount(resp?.usage?.output_tokens),
        },
        activeCreds.model,
        activeCreds.provider
      );
      const content: any[] = Array.isArray(resp?.content) ? resp.content : [];
      const toolUses = content.filter((b) => b?.type === "tool_use");

      // ไม่เรียกทูลแล้ว → คืน text สุดท้าย
      if (resp?.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        // เทิร์นที่ไม่มี text block เลย **ไม่ใช่คำตอบ** — เกิดจริงเมื่อ output ถูกตัดที่
        // max_tokens กลาง tool_use (content เหลือแต่ tool_use ที่ JSON ยังไม่จบ ส่วน
        // stop_reason เป็น "max_tokens" ไม่ใช่ "tool_use" จึงตกมาถึงบรรทัดนี้)
        //
        // เดิมเคสนี้ถูกปิดเป็น status "completed" แล้วคืน reply ว่าง ทำให้ caller ไปใช้
        // ข้อความ "ช่วยพิมพ์ใหม่" — ลูกค้าพิมพ์ถูกแต่ถูกโทษ และ ops ไม่เห็นอะไรเลย
        // (เจอบน production 2026-08-19 ตะกร้า 3 รายการของร้านยา)
        const hasBoundedFallbackForTruncation =
          resp?.stop_reason === "max_tokens" && Boolean(latestVerifiedFallback);
        if (!reply || hasBoundedFallbackForTruncation) {
          const stopReason = typeof resp?.stop_reason === "string" ? resp.stop_reason : "unknown";
          const failureKind = reply ? "truncated_model_reply" : "empty_model_reply";
          const detail = `${failureKind} (stop_reason=${stopReason}, tool_use_blocks=${toolUses.length}, round=${round + 1})`;
          if (creds.usageEventId) {
            await finalizeUsage(creds.usageEventId, {
              status: "fallback",
              ...usagePayload(),
              errorMessage: detail,
            });
          }
          await reportToolFailure(reportFailure, "ai.empty_reply", opts.execCtx, detail, {
            stopReason,
            toolUseBlocks: toolUses.length,
            round: round + 1,
            maxTokens: maxTokensForSurface(opts.execCtx.surface),
            toolsCalled: trace.map((t) => t.tool),
          });
          return {
            reply: latestVerifiedFallback ?? "",
            proposals,
            trace,
            usedAi: true,
            systemFailure: "empty_reply",
          };
        }
        if (creds.usageEventId) {
          await finalizeUsage(creds.usageEventId, {
            status: "completed",
            ...usagePayload(),
          });
        }
        return { reply, proposals, trace, usedAi: true };
      }

      // เก็บ assistant turn (มี tool_use blocks) ไว้ในสาย
      messages.push({ role: "assistant", content });

      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const toolName = typeof tu?.name === "string" ? tu.name : "unknown";
        const tool = byName.get(toolName);
        let resultContent: string;
        let outcome: "ok" | "error" | "denied" | "proposal" | "unknown" = "unknown";
        let traceInput: Record<string, unknown> = {};

        if (!tool) {
          resultContent = JSON.stringify({ error: `ไม่รู้จักทูล ${toolName}` });
          trace.push({ tool: toolName, input: {}, ok: false, summary: "unknown tool" });
        } else {
          try {
            await authorizeTool(tool, opts.execCtx);
            traceInput = inputRecord(tu.input ?? {});
            validateKnownFields(tool, traceInput);
            const callKey = `${toolName}:${stableJson(traceInput)}`;
            const completed = completedCalls.get(callKey);
            if (completed) {
              outcome = completed.outcome;
              resultContent = completed.resultContent;
              if (completed.fallbackReply) latestVerifiedFallback = completed.fallbackReply;
              trace.push({
                tool: toolName,
                input: traceInput,
                ok: true,
                summary: `duplicate suppressed: ${completed.summary}`,
              });
            } else {
              assertSingleCustomerOrderWrite(tool, opts.execCtx);
              const r = await executeToolBounded(tool, traceInput, opts.execCtx);
              if (r.ok && r.proposal) {
                if (!tool.sensitive) throw new Error("non-sensitive tool returned a proposal");
                proposals.push(r.proposal);
                outcome = "proposal";
                resultContent = JSON.stringify({
                  status: "PENDING_CONFIRMATION",
                  note: "สร้างคำขอแล้ว รอมนุษย์กดยืนยันใน UI — ยังไม่สำเร็จ ห้ามแจ้งว่าทำเสร็จแล้ว",
                  summary: r.proposal.summary,
                });
                const summary = `proposal: ${r.proposal.summary}`;
                completedCalls.set(callKey, { resultContent, outcome, summary });
                trace.push({ tool: toolName, input: traceInput, ok: true, summary });
              } else if (r.ok) {
                if (tool.sensitive) throw new Error("sensitive tool must return a proposal");
                outcome = "ok";
                resultContent = JSON.stringify(r.data ?? { ok: true });
                let fallbackReply: string | null = null;
                if (tool.fallbackReply) {
                  try {
                    const formatted = tool.fallbackReply(r.data, opts.execCtx, traceInput);
                    fallbackReply = typeof formatted === "string"
                      ? formatted.trim().slice(0, 4_000) || null
                      : null;
                  } catch (formatError) {
                    console.error(`[BMS] tool ${toolName} fallback formatter failed:`, formatError);
                    await reportToolFailure(reportFailure, "ai.tool_failed", opts.execCtx, formatError, {
                      tool: toolName,
                      route: "fallback_formatter",
                    });
                  }
                }
                if (fallbackReply) latestVerifiedFallback = fallbackReply;
                completedCalls.set(callKey, { resultContent, outcome, summary: "ok", fallbackReply });
                trace.push({ tool: toolName, input: traceInput, ok: true, summary: "ok" });
              } else {
                outcome = "error";
                resultContent = JSON.stringify({ error: r.error });
                trace.push({ tool: toolName, input: traceInput, ok: false, summary: r.error });
              }
            }
          } catch (err: any) {
            const denied = err instanceof ToolAccessError;
            outcome = denied ? "denied" : "error";
            const msg = err instanceof ToolArgError || denied ? err.message : "ดึงข้อมูลไม่สำเร็จ";
            resultContent = JSON.stringify({ error: msg });
            trace.push({ tool: toolName, input: traceInput, ok: false, summary: msg });
            if (!(err instanceof ToolArgError) && !denied) {
              console.error(`[BMS] tool ${toolName} failed:`, err);
              await reportToolFailure(reportFailure, "ai.tool_failed", opts.execCtx, err, {
                tool: toolName,
                route: "model_selected",
              });
            }
          }
        }
        await auditAttempt(opts.execCtx, toolName, outcome, tool);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultContent });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // เกิน MAX_ROUNDS — best-effort (เคสหายาก)
    if (creds.usageEventId) {
      await finalizeUsage(creds.usageEventId, {
        status: "fallback",
        ...usagePayload(),
        errorMessage: "max_rounds_exceeded",
      });
    }
    await reportToolFailure(
      reportFailure,
      "ai.loop_timeout",
      opts.execCtx,
      `max_rounds_exceeded (${MAX_ROUNDS})`,
      { rounds: MAX_ROUNDS, toolsCalled: trace.map((t) => t.tool) }
    );
    return {
      reply: latestVerifiedFallback ?? "ขออภัยค่ะ ระบบประมวลผลนานเกินไป ลองใหม่อีกครั้งนะคะ",
      proposals,
      trace,
      usedAi: true,
    };
  } catch (err) {
    if (creds.usageEventId) {
      await finalizeUsage(creds.usageEventId, {
        status: "failed",
        ...usagePayload(),
        errorMessage: err instanceof Error ? err.message : "tool-loop error",
      });
    }
    // provider call ล้มเหลว (network/timeout/!=2xx) — คืน usedAi:true กันการ retry แบบ rule-based
    // (ถ้ามีทูล write ทำงานไปแล้วในรอบก่อน จะไม่ถูกทำซ้ำ)
    console.error("[BMS] tool-loop error:", err);
    await reportToolFailure(reportFailure, "ai.loop_failed", opts.execCtx, err, {
      toolsCalled: trace.map((t) => t.tool),
    });
    return {
      reply: latestVerifiedFallback ?? "ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ",
      proposals,
      trace,
      usedAi: true,
    };
  }
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  return runToolLoopInternal(opts);
}

export async function runApprovedTool(
  opts: ApprovedToolOptions
): Promise<{ result: ToolResult; trace: ToolTraceEntry }> {
  return runApprovedToolInternal(opts);
}

/** @internal ใช้เฉพาะ scripts/ai-eval/runtime-contract.test.mts */
export const __toolLoopTest = {
  run: runToolLoopInternal,
  runApproved: runApprovedToolInternal,
  providerRequestBody,
};
