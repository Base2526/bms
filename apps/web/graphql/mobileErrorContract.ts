import { GraphQLError, type GraphQLFormattedError } from "graphql/error";

import { isIdempotencyConflictError } from "@/lib/bms/idempotencyErrors";

export const BMS_GRAPHQL_CLIENT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "BAD_USER_INPUT",
  "NOT_FOUND",
  "CONFLICT",
] as const;

export type BmsGraphqlClientErrorCode = (typeof BMS_GRAPHQL_CLIENT_ERROR_CODES)[number];

/** Client-correctable GraphQL errors. Business rejections remain successful data with status. */
export function mobileGraphqlError(
  message: string,
  code: BmsGraphqlClientErrorCode,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { ...extra, code },
  });
}

/**
 * เดินลงไปหา error ตัวจริงใต้ชั้นที่ GraphQL ห่อไว้ (resolver throw → wrap อย่างน้อยหนึ่งชั้น)
 *
 * ตรวจด้วย "มีฟิลด์ originalError ไหม" ไม่ใช่ `instanceof GraphQLError` โดยตั้งใจ — แพ็กเกจ
 * `graphql` ถูกติดตั้งไว้ที่ `apps/web/node_modules` เท่านั้น เทสใน `scripts/` import ตรง ๆ ไม่ได้
 * (กับดักเดิมของรีโปนี้) และการมี `graphql` สองสำเนาในกระบวนการเดียวทำให้ instanceof พังเงียบ ๆ
 */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const nested = (current as { originalError?: unknown } | null)?.originalError;
    if (!nested) return current;
    current = nested;
  }
  return current;
}

/**
 * Apollo normally adds INTERNAL_SERVER_ERROR itself. Keep a repo-owned final guard so plugins,
 * upload handling, and future custom GraphQLError sites cannot emit an error with no stable code.
 *
 * ตัวนี้ยัง **จัดประเภทให้คีย์กันรายการซ้ำที่ชนกัน** ด้วย — service ที่ถือคีย์ (สต็อกสาขาและ
 * บอร์ดเกม) ปฏิเสธเคสนี้ด้วยการ throw จากหลายสิบจุด การไปห่อทีละ resolver คือลิสต์ที่รอวันลืม
 * ส่วนรหัสที่ปล่อยไว้เฉย ๆ (`INTERNAL_SERVER_ERROR`) แปลว่า "ลองใหม่ด้วยคีย์เดิม" ตามเอกสาร
 * สัญญาไคลเอนต์ ซึ่งกับเคสนี้คือวนล้มแบบเดิมตลอดไป
 */
export function ensureBmsGraphqlErrorCode(
  error: GraphQLFormattedError,
  originalError?: unknown,
): GraphQLFormattedError {
  const declared = typeof error.extensions?.code === "string" && error.extensions.code.trim()
    ? error.extensions.code
    : null;
  const conflict = isIdempotencyConflictError(rootCause(originalError));
  const code = conflict && !declared ? "CONFLICT" : declared ?? "INTERNAL_SERVER_ERROR";
  return {
    ...error,
    extensions: {
      ...error.extensions,
      ...(conflict ? { reason: "IDEMPOTENCY_CONFLICT" } : {}),
      code,
    },
  };
}
