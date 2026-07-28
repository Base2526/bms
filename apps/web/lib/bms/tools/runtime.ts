// =============================================================
// BMS AI Tools — Claude tool-use runtime (the tool-calling loop)
// -------------------------------------------------------------
// วน: Claude → (tool_use) → validate+execute service → tool_result → จนได้ text
// - bounded: MAX_ROUNDS + timeout ต่อ call (ตาม AI_GUIDELINES § Reliability)
// - ทูล sensitive (A3) คืน proposal → ไม่ execute, ป้อนกลับว่า "รอมนุษย์ยืนยัน"
// - ไม่มี credentials (ไม่มี key/เกิน quota) → usedAi:false ให้ caller fallback
// - callClaude ล้มเหลวหลังเริ่ม loop → usedAi:true + safe error (ไม่ fallback ไป write ซ้ำ)
// =============================================================

import { resolveAiCredentials, type AiCredentials } from "../ai";
import { estimateCachedAiCostUsd, finalizeAiUsageEvent } from "../aiUsage";
import { audit } from "../audit";
import { requirePermission } from "../permissions";
import {
  ToolArgError,
  type BmsTool,
  type ExecCtx,
  type ToolProposal,
  type ToolResult,
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
const MAX_TOKENS = 1024;
const EPHEMERAL_CACHE_CONTROL: AnthCacheControl = { type: "ephemeral" };

class ToolAccessError extends Error {}

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

async function callClaude(
  creds: AiCredentials,
  system: string | AnthSystemBlock[],
  messages: AnthMessage[],
  tools: AnthToolSchema[]
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": creds.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: creds.model, max_tokens: MAX_TOKENS, system, tools, messages }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
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
 * Anthropic transport, usage finalizer, and audit writer. Keeping the seam at the function boundary
 * lets the eval suite force timeout/malformed/unknown-tool paths without exposing a diagnostic HTTP
 * endpoint or weakening any runtime authorization.
 */
export type ToolLoopTestDeps = {
  resolveCredentials?: typeof resolveAiCredentials;
  callProvider?: typeof callClaude;
  finalizeUsage?: typeof finalizeAiUsageEvent;
  auditAttempt?: typeof auditToolCall;
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
  deps: Pick<ToolLoopTestDeps, "auditAttempt"> = {}
): Promise<{ result: ToolResult; trace: ToolTraceEntry }> {
  const auditAttempt = deps.auditAttempt ?? auditToolCall;
  const { tool, execCtx } = opts;
  let input: Record<string, unknown> = {};
  let outcome: "ok" | "error" | "denied" | "proposal" = "error";
  let result: ToolResult;
  let trace: ToolTraceEntry;

  try {
    await authorizeTool(tool, execCtx);
    input = inputRecord(opts.input ?? {});
    validateKnownFields(tool, input);
    const executed = await tool.execute(input, execCtx);
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
  const callProvider = deps.callProvider ?? callClaude;
  const finalizeUsage = deps.finalizeUsage ?? finalizeAiUsageEvent;
  const auditAttempt = deps.auditAttempt ?? auditToolCall;

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
    provider: "anthropic",
    meta: {
      actor: opts.execCtx.actor,
      ...(opts.usageMeta ?? {}),
    },
  });
  if (!creds) return { reply: "", proposals: [], trace: [], usedAi: false };
  const model = creds.model;

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
    }
  >();
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;

  function usagePayload() {
    return {
      inputTokens:
        inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
      // ส่ง breakdown ไปเก็บใน meta ด้วย — คอลัมน์ input_tokens เป็นผลรวมจึงบอกไม่ได้ว่า cache hit หรือไม่
      cacheCreationInputTokens,
      cacheReadInputTokens,
      outputTokens,
      estimatedCost: estimateCachedAiCostUsd(
        {
          inputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
          outputTokens,
        },
        model
      ),
    };
  }

  // สำคัญ (write-safety): เมื่อมี credentials แล้ว ถือว่า AI "ทำงานแล้ว" (usedAi:true) เสมอ
  // แม้ callClaude จะล้มกลางคัน — เพื่อไม่ให้ caller ไปรัน rule-based ที่อาจ createOrder ซ้ำ
  // หลังจากทูล create_order ทำงานไปแล้วในรอบก่อนหน้า
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await callProvider(creds, cachedSystem, messages, toolSchemas);
      inputTokens += tokenCount(resp?.usage?.input_tokens);
      cacheCreationInputTokens += tokenCount(
        resp?.usage?.cache_creation_input_tokens
      );
      cacheReadInputTokens += tokenCount(resp?.usage?.cache_read_input_tokens);
      outputTokens += tokenCount(resp?.usage?.output_tokens);
      const content: any[] = Array.isArray(resp?.content) ? resp.content : [];
      const toolUses = content.filter((b) => b?.type === "tool_use");

      // ไม่เรียกทูลแล้ว → คืน text สุดท้าย
      if (resp?.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
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
              trace.push({
                tool: toolName,
                input: traceInput,
                ok: true,
                summary: `duplicate suppressed: ${completed.summary}`,
              });
            } else {
              const r = await tool.execute(traceInput, opts.execCtx);
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
                completedCalls.set(callKey, { resultContent, outcome, summary: "ok" });
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
            if (!(err instanceof ToolArgError) && !denied) console.error(`[BMS] tool ${toolName} failed:`, err);
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
    return {
      reply: "ขออภัยค่ะ ระบบประมวลผลนานเกินไป ลองใหม่อีกครั้งนะคะ 🙏",
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
    // callClaude ล้มเหลว (network/timeout/!=2xx) — คืน usedAi:true กันการ retry แบบ rule-based
    // (ถ้ามีทูล write ทำงานไปแล้วในรอบก่อน จะไม่ถูกทำซ้ำ)
    console.error("[BMS] tool-loop error:", err);
    return {
      reply: "ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ 🙏",
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
};
