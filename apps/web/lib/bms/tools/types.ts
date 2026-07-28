// =============================================================
// BMS AI Tools — shared types + arg validation helpers
// -------------------------------------------------------------
// ทูลแต่ละตัวเป็น wrapper บาง ๆ ของ service ใน lib/bms/*.ts
// ไม่ทำ business logic ซ้ำ · validate args จาก model ก่อนเรียก service เสมอ
// ยึดตาม docs/AI_GUIDELINES.md (§ Tool design and execution)
// =============================================================

import type { BmsPermission } from "../permissions";
import type { Channel } from "../pipeline";

export type ToolSurface = "customer" | "staff";

/** context ที่ runtime ส่งให้ execute() — tenant มาจาก server เสมอ (model เลือกไม่ได้) */
export type ExecCtx = {
  tenantId: string;
  surface: ToolSurface;
  /** ใช้ลง audit: "ai:customer" (customer) หรือ email แอดมิน (staff) */
  actor: string;
  /** customer surface: ช่องทาง + external ref ของลูกค้า (ใช้ scope การอ่านให้เป็นของลูกค้าคนนั้น) */
  channel?: Channel;
  customerRef?: string | null;
  /** staff surface: GraphQL ctx จริง (สำหรับ requirePermission/audit) */
  ctx?: any;
};

/** JSON schema แบบ Anthropic tool (input_schema) */
export type ToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** proposal ของทูล sensitive (A3) — ไม่ execute, ให้มนุษย์กด Confirm เพื่อยิง mutation เดิม */
export type ToolProposal = {
  tool: string;
  /** GraphQL mutation เดิมที่ปุ่ม Confirm จะยิง (permission-gated อยู่แล้ว) */
  mutation: string;
  args: Record<string, unknown>;
  /** สรุปภาษาไทยว่าจะเกิดอะไรกับ record ไหน (ตาม § Human confirmation) */
  summary: string;
};

export type ToolResult =
  | { ok: true; data?: unknown; proposal?: ToolProposal }
  | { ok: false; error: string };

export type BmsTool = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  surfaces: ToolSurface[];
  /** staff RBAC — customer surface ไม่ใช้ (เปิดเฉพาะทูลปลอดภัยตั้งแต่ registry) */
  permission?: BmsPermission;
  /** true = propose-only (ไม่ execute จาก AI) */
  sensitive?: boolean;
  execute: (args: Record<string, any>, ec: ExecCtx) => Promise<ToolResult>;
};

// ---- arg validation helpers (model-supplied args = untrusted) ----

export class ToolArgError extends Error {}

export function reqString(args: Record<string, any>, key: string): string {
  const v = args?.[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ToolArgError(`ต้องระบุ "${key}" (ข้อความ)`);
  }
  return v.trim();
}

export function optString(args: Record<string, any>, key: string): string | undefined {
  const v = args?.[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ToolArgError(`"${key}" ต้องเป็นข้อความ`);
  return v.trim();
}

export function reqInt(args: Record<string, any>, key: string, min = 1): number {
  const v = args?.[key];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min) {
    throw new ToolArgError(`"${key}" ต้องเป็นจำนวนเต็ม ≥ ${min}`);
  }
  return n;
}

// max (ถ้าระบุ) = clamp ไม่ throw — limit/ช่วงวันที่ที่โมเดลส่งมาเกินเพดานไม่ควรทำให้ทูลล้มเหลว
// แล้วเสีย turn ไปกับการ retry แค่จำกัดให้เท่าเพดานที่ schema ประกาศไว้ กัน tool_result บานปลาย
// (payload เข้า context ทุกรอบถัดไปและไม่ถูก cache) และกันช่วง query ยาวเกินจริง
export function optInt(
  args: Record<string, any>,
  key: string,
  min = 1,
  max?: number
): number | undefined {
  const v = args?.[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = reqInt(args, key, min);
  return typeof max === "number" ? Math.min(n, max) : n;
}

export function enumVal<T extends string>(
  args: Record<string, any>,
  key: string,
  allowed: readonly T[],
  required = true
): T | undefined {
  const v = args?.[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolArgError(`ต้องระบุ "${key}" (${allowed.join("/")})`);
    return undefined;
  }
  if (!allowed.includes(v)) {
    throw new ToolArgError(`"${key}" ต้องเป็นหนึ่งใน: ${allowed.join(", ")}`);
  }
  return v as T;
}

/** items[] สำหรับ create_order / create_purchase_order */
export function reqItems(
  args: Record<string, any>,
  key = "items"
): Array<{ sku: string; size: string; qty: number }> {
  const raw = args?.[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolArgError(`ต้องระบุ "${key}" อย่างน้อย 1 รายการ`);
  }
  return raw.map((it, i) => {
    if (!it || typeof it !== "object") throw new ToolArgError(`${key}[${i}] ไม่ถูกต้อง`);
    const sku = typeof it.sku === "string" ? it.sku.trim() : "";
    const size = typeof it.size === "string" ? it.size.trim() : "";
    const qty = Number(it.qty);
    if (!sku) throw new ToolArgError(`${key}[${i}].sku ต้องระบุ`);
    if (!size) throw new ToolArgError(`${key}[${i}].size ต้องระบุ`);
    if (!Number.isInteger(qty) || qty < 1) throw new ToolArgError(`${key}[${i}].qty ต้องเป็นจำนวนเต็ม ≥ 1`);
    return { sku, size, qty };
  });
}
