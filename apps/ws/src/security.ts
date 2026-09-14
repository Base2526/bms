import { Kind, getOperationAST, parse } from "graphql";

/**
 * ⚠️ ลิสต์นี้คือ "ฟีเจอร์ที่หายไปจาก production" ไม่ใช่แค่ค่าตั้งค่า — ใส่ชื่อเพิ่มเมื่อใด
 * ผู้ใช้จะเห็นจอที่ไม่อัปเดตเอง โดยไม่มี error ที่ไหนบอกว่าทำไม
 *
 * เดิมลิสต์นี้ถือ 5 subscription ของแชท/คอมเมนต์ไว้ด้วย เพราะตอนนั้นมันรับ `chat_id`/`post_id`
 * จากผู้เรียกแล้ว **ไม่ตรวจอะไรเลย** (`messageAdded`/`messageDeleted` ไม่เรียก
 * `requireRealtimeUserId` ด้วยซ้ำ และ `commentDeleted` คืน `true` เสมอ) · ตอนนี้ทั้งห้าตัว
 * ตัดสินจาก routing data ที่ publisher แนบมา + ต้องถือ ticket ที่ระบุตัวตนได้ จึงถูกเปิดกลับ
 * — ปล่อยให้ปิดไว้ทั้งที่แก้แล้วเท่ากับทิ้งข้อความสดในห้องแชทและคอมเมนต์สดของโพสต์ไปเฉย ๆ
 *
 * `time` ยังปิดอยู่เพราะเป็นตัวจับเวลาสำหรับดีบั๊ก ไม่มีหน้าจอไหนของสินค้านี้ใช้ และมันยิง
 * ทุกวินาทีเข้าทุก connection
 */
export const PRODUCTION_DISABLED_SUBSCRIPTIONS = new Set([
  "time",
]);

export function positiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseAllowedOrigins(value: string | undefined, production: boolean): Set<string> {
  const origins = new Set(
    String(value || (production ? "" : "http://localhost:3000,http://127.0.0.1:3000"))
      .split(",").map((item) => item.trim()).filter(Boolean).map((item) => new URL(item).origin),
  );
  if (production && origins.size === 0) throw new Error("WS_ALLOWED_ORIGINS is required in production");
  return origins;
}

export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!origin) return false;
  try { return allowed.has(new URL(origin).origin); } catch { return false; }
}

export function inspectSubscriptionOperation(input: {
  query: unknown;
  operationName?: unknown;
  variables?: unknown;
  maximumQueryBytes: number;
  maximumVariablesBytes: number;
  production: boolean;
}) {
  if (typeof input.query !== "string") throw new Error("QUERY_REQUIRED");
  if (new TextEncoder().encode(input.query).byteLength > input.maximumQueryBytes) throw new Error("QUERY_TOO_LARGE");
  const variableText = JSON.stringify(input.variables ?? {});
  if (new TextEncoder().encode(variableText).byteLength > input.maximumVariablesBytes) throw new Error("VARIABLES_TOO_LARGE");
  const document = parse(input.query, { maxTokens: 2_000 });
  const operationName = typeof input.operationName === "string" ? input.operationName : undefined;
  const operation = getOperationAST(document, operationName);
  if (!operation || operation.operation !== "subscription") throw new Error("SUBSCRIPTIONS_ONLY");
  const fields = operation.selectionSet.selections
    .filter((node) => node.kind === Kind.FIELD)
    .map((node) => node.name.value);
  if (fields.length !== 1) throw new Error("ONE_SUBSCRIPTION_FIELD_REQUIRED");
  if (input.production && PRODUCTION_DISABLED_SUBSCRIPTIONS.has(fields[0])) throw new Error("SUBSCRIPTION_DISABLED");
  return { document, operationName, fieldName: fields[0] };
}

function keySegment(value: string): string {
  return encodeURIComponent(value).slice(0, 256);
}

export function realtimeConnectionLeaseLimits(input: {
  ip: string;
  subjectId: string;
  tenantId?: string;
  maximumPerIp: number;
  maximumPerUser: number;
  maximumPerTenant: number;
}) {
  const limits = [
    { key: `bms:rt:conn:ip:${keySegment(input.ip)}`, maximum: input.maximumPerIp },
    { key: `bms:rt:conn:user:${keySegment(input.subjectId)}`, maximum: input.maximumPerUser },
  ];
  if (input.tenantId) limits.push({ key: `bms:rt:conn:tenant:${keySegment(input.tenantId)}`, maximum: input.maximumPerTenant });
  return limits;
}
