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
import { audit } from "../audit";
import { requirePermission } from "../permissions";
import { ToolArgError, type BmsTool, type ExecCtx, type ToolProposal } from "./types";

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

const MAX_ROUNDS = 5;
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 1024;

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
  system: string,
  messages: AnthMessage[],
  tools: Array<{ name: string; description: string; input_schema: unknown }>
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

export async function runToolLoop(opts: {
  tenantId: string;
  system: string;
  messages: AnthMessage[];
  tools: BmsTool[];
  execCtx: ExecCtx;
}): Promise<ToolLoopResult> {
  if (opts.tenantId !== opts.execCtx.tenantId) {
    throw new Error("AI tool-loop tenant context mismatch");
  }
  const uniqueNames = new Set(opts.tools.map((tool) => tool.name));
  if (uniqueNames.size !== opts.tools.length) {
    throw new Error("AI tool registry contains duplicate names");
  }
  const creds = await resolveAiCredentials(opts.tenantId);
  if (!creds) return { reply: "", proposals: [], trace: [], usedAi: false };

  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const toolSchemas = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      ...t.inputSchema,
      additionalProperties: t.inputSchema.additionalProperties ?? false,
    },
  }));

  const proposals: ToolProposal[] = [];
  const trace: ToolTraceEntry[] = [];
  const messages: AnthMessage[] = [...opts.messages];

  // สำคัญ (write-safety): เมื่อมี credentials แล้ว ถือว่า AI "ทำงานแล้ว" (usedAi:true) เสมอ
  // แม้ callClaude จะล้มกลางคัน — เพื่อไม่ให้ caller ไปรัน rule-based ที่อาจ createOrder ซ้ำ
  // หลังจากทูล create_order ทำงานไปแล้วในรอบก่อนหน้า
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await callClaude(creds, opts.system, messages, toolSchemas);
      const content: any[] = Array.isArray(resp?.content) ? resp.content : [];
      const toolUses = content.filter((b) => b?.type === "tool_use");

      // ไม่เรียกทูลแล้ว → คืน text สุดท้าย
      if (resp?.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
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
              trace.push({ tool: toolName, input: traceInput, ok: true, summary: `proposal: ${r.proposal.summary}` });
            } else if (r.ok) {
              if (tool.sensitive) throw new Error("sensitive tool must return a proposal");
              outcome = "ok";
              resultContent = JSON.stringify(r.data ?? { ok: true });
              trace.push({ tool: toolName, input: traceInput, ok: true, summary: "ok" });
            } else {
              outcome = "error";
              resultContent = JSON.stringify({ error: r.error });
              trace.push({ tool: toolName, input: traceInput, ok: false, summary: r.error });
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
        await auditToolCall(opts.execCtx, toolName, outcome, tool);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultContent });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // เกิน MAX_ROUNDS — best-effort (เคสหายาก)
    return {
      reply: "ขออภัยค่ะ ระบบประมวลผลนานเกินไป ลองใหม่อีกครั้งนะคะ 🙏",
      proposals,
      trace,
      usedAi: true,
    };
  } catch (err) {
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
