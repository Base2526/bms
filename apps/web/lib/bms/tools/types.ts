// =============================================================
// BMS AI Tools — shared types + arg validation helpers
// -------------------------------------------------------------
// ทูลแต่ละตัวเป็น wrapper บาง ๆ ของ service ใน lib/bms/*.ts
// ไม่ทำ business logic ซ้ำ · validate args จาก model ก่อนเรียก service เสมอ
// ยึดตาม docs/AI_GUIDELINES.md (§ Tool design and execution)
// =============================================================

import type { OrderQuoteLine } from "../orderQuote";
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
  /**
   * แชทที่กำลังคุยอยู่ — ใช้เฉพาะการแจ้งเตือน/ไล่ปัญหา (reportBmsFailure) ให้ลิงก์
   * ไปแชทที่ได้รับผลกระทบได้ ห้ามใช้ scope การอ่านข้อมูล (ยังต้องใช้ channel +
   * customerRef เหมือนเดิม เพื่อไม่ให้ scope ความปลอดภัยขึ้นกับค่าที่ส่งมาเพิ่ม)
   */
  conversationId?: string | null;
  /**
   * Server-only signal set by create_order/reorder. It is never model-supplied and lets the
   * customer pipeline replace the model's closing prose with the verified checkout link.
   */
  createdOrderId?: string;
  /** Server-only tracking id for a product purchase routed to pharmacist review. */
  pharmacyReviewCaseId?: string;
  /**
   * Server-only. Set by the pipeline (never by the model) when the customer's own
   * message affirms a basket that was itemised back to them on a previous turn.
   * The fingerprint pins the affirmation to that exact basket, so a model cannot
   * change a quantity or slip an item in after the customer has said yes.
   */
  customerConfirmedQuote?: { fingerprint: string } | null;
  /**
   * Server-only signal set by create_order when it declines to write because the
   * customer has not confirmed this basket yet. Carries structured lines rather
   * than finished prose so the pipeline — which is the only layer that knows the
   * conversation language — composes the wording.
   */
  pendingOrderQuote?: { fingerprint: string; lines: OrderQuoteLine[] };
  /** staff surface: GraphQL ctx จริง (สำหรับ requirePermission/audit) */
  ctx?: any;
  /**
   * Server-derived effective permissions for capability/guide explanations.
   * Tools with a permission still pass requirePermission() before execution.
   */
  permissions?: ReadonlySet<string>;
  /** Server-derived account class for help-link visibility; never grants tool execution. */
  role?: string | null;
  isPlatformAdmin?: boolean;
  /** Server-derived retrieval hints. They never grant authorization. */
  currentPath?: string | null;
  pageId?: string | null;
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

  // ---- registry-only metadata (สำหรับ docs/human, ไม่ถูกส่งเข้า Anthropic tool schema) ----
  // ดู tools/runtime.ts (~L370): payload ที่ยิงจริงมีแค่ name/description/input_schema เท่านั้น
  // ฟิลด์ด้านล่างนี้ "ฟรี" ไม่กิน token ต่อ turn — จะกินก็ต่อเมื่อ deliberately ต่อท้ายเข้า `description` เอง
  // (แนะนำทำเฉพาะกลุ่มทูลที่เคยสับสน/เรียกผิดจริง ไม่ต้องทำครบทุกทูล)
  /** ใช้ตอนไหน — เขียนไว้กันทูลที่ทับซ้อนกัน (เช่น search_products vs browse_catalog vs recommend_products) */
  whenToUse?: string;
  /** อย่าใช้ตอนไหน — คู่กับ whenToUse */
  whenNotToUse?: string;
  /** ข้อผิดพลาดที่เคยเกิดจริง (จาก eval/production) กันโมเดล/คนแก้ทูลทำซ้ำ */
  commonMistakes?: string[];
  /** ตัวอย่าง args ที่ถูกต้อง 1 ชุด (+ note อธิบายบริบท) สำหรับ docs/registry */
  example?: { input: Record<string, unknown>; note?: string };
};

/** Fail fast when the authoritative registry drifts into an unsafe or unusable shape. */
export function assertValidToolRegistry(tools: readonly BmsTool[]): void {
  const names = new Set<string>();

  for (const tool of tools) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(tool.name)) {
      throw new Error(`AI tool registry name must be snake_case: ${tool.name}`);
    }
    if (names.has(tool.name)) {
      throw new Error(`AI tool registry contains duplicate name: ${tool.name}`);
    }
    names.add(tool.name);

    if (!tool.description.trim()) {
      throw new Error(`AI tool registry description is empty: ${tool.name}`);
    }
    if (tool.surfaces.length === 0 || new Set(tool.surfaces).size !== tool.surfaces.length) {
      throw new Error(`AI tool registry surfaces are invalid: ${tool.name}`);
    }
    if (tool.sensitive && (tool.surfaces.length !== 1 || tool.surfaces[0] !== "staff")) {
      throw new Error(`Sensitive AI tool must be staff-only: ${tool.name}`);
    }
    if (tool.inputSchema.type !== "object" || !tool.inputSchema.properties) {
      throw new Error(`AI tool registry input schema is invalid: ${tool.name}`);
    }
    for (const field of tool.inputSchema.required ?? []) {
      if (!(field in tool.inputSchema.properties)) {
        throw new Error(`AI tool registry required field is undeclared: ${tool.name}.${field}`);
      }
    }
    if (tool.commonMistakes?.some((mistake) => !mistake.trim())) {
      throw new Error(`AI tool registry has an empty commonMistakes entry: ${tool.name}`);
    }
  }
}

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

/**
 * items[] สำหรับ create_order / create_purchase_order
 *
 * `packCode` เป็น optional และเป็น **ชื่อหน่วยขายเท่านั้น** (เช่น "BLISTER")
 * จำนวนเม็ดต่อหน่วยและราคาต่อหน่วยถูกอ่านจาก bms_product_packs ที่ฝั่ง server
 * เสมอ — ห้ามเพิ่ม field ราคาหรือ baseQty เข้ามาที่นี่เด็ดขาด ไม่ว่าจะสะดวกแค่ไหน
 * เพราะเท่ากับให้โมเดลตั้งราคาขายของร้าน (ดู resolveSellablePack ใน productPacks.ts)
 *
 * create_purchase_order ไม่ส่ง packCode มา จึงไม่ได้รับผลจากการเพิ่มนี้
 */
export function reqItems(
  args: Record<string, any>,
  key = "items"
): Array<{ sku: string; size: string; qty: number; packCode?: string }> {
  const raw = args?.[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolArgError(`ต้องระบุ "${key}" อย่างน้อย 1 รายการ`);
  }
  return raw.map((it, i) => {
    if (!it || typeof it !== "object") throw new ToolArgError(`${key}[${i}] ไม่ถูกต้อง`);
    const sku = typeof it.sku === "string" ? it.sku.trim() : "";
    const size = typeof it.size === "string" ? it.size.trim() : "";
    const qty = Number(it.qty);
    const packCode = typeof it.packCode === "string" ? it.packCode.trim() : "";
    if (!sku) throw new ToolArgError(`${key}[${i}].sku ต้องระบุ`);
    if (!size) throw new ToolArgError(`${key}[${i}].size ต้องระบุ`);
    if (!Number.isInteger(qty) || qty < 1) throw new ToolArgError(`${key}[${i}].qty ต้องเป็นจำนวนเต็ม ≥ 1`);
    return packCode ? { sku, size, qty, packCode } : { sku, size, qty };
  });
}
