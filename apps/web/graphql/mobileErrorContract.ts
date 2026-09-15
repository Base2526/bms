import { GraphQLError, type GraphQLFormattedError } from "graphql/error";

import { isBoardGamePosError } from "@/lib/bms/boardGamePosOperations";
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
  // ⚠️ "adapter ระบุรหัสมาเอง" หมายถึงรหัสที่ **ไคลเอนต์แก้เองได้** เท่านั้น
  //
  // Apollo เติม `INTERNAL_SERVER_ERROR` ลง `extensions.code` ให้ตั้งแต่ก่อน `formatError` ทำงาน
  // ถ้านับค่านั้นว่า "ระบุมาแล้ว" ตัวจัดประเภทข้างล่างจะไม่มีวันได้ทำงานในเส้นทางจริงเลย —
  // ซึ่งเป็นสิ่งที่เกิดขึ้นจริง: การปฏิเสธตามกติกาของบอร์ดเกมทุกตัวออกไปเป็น 500 ที่เอกสารสัญญา
  // ของไคลเอนต์สั่งให้ยิงซ้ำด้วยคีย์เดิม = วนล้มแบบเดิมตลอดไป · เทสเดิมเขียวเพราะป้อน error ที่
  // ยังไม่มี code เข้ามา ซึ่งไม่ใช่รูปที่ Apollo ส่งให้จริง
  const rawCode = typeof error.extensions?.code === "string" ? error.extensions.code.trim() : "";
  const declared = (BMS_GRAPHQL_CLIENT_ERROR_CODES as readonly string[]).includes(rawCode)
    ? rawCode
    : null;
  const cause = rootCause(originalError);
  const conflict = isIdempotencyConflictError(cause);
  // การปฏิเสธของเส้นบอร์ดเกมมาจาก `throw new Error(...)` ในชั้น service เหมือนกัน — ปล่อยไว้
  // จะได้ `INTERNAL_SERVER_ERROR` ซึ่งแปลว่า "ยิงซ้ำด้วยคีย์เดิม" · `REJECTED` ตอบเป็น CONFLICT
  // เพราะส่วนใหญ่คือ "สถานะจริงตอนนี้ไม่ให้ทำแล้ว" ซึ่งต้องดึงของจริงมาดูก่อน ไม่ใช่ยิงซ้ำ
  const rejected = isBoardGamePosError(cause) ? cause : null;
  const rejectedCode = rejected
    ? (rejected.reason === "BAD_INPUT"
      ? "BAD_USER_INPUT"
      : rejected.reason === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT")
    : null;
  const code = declared
    ?? (conflict ? "CONFLICT" : null)
    ?? rejectedCode
    // รหัสอื่นที่ไม่ใช่ชุดของไคลเอนต์ (รวม INTERNAL_SERVER_ERROR ของ Apollo) เก็บไว้ตามเดิม
    ?? (rawCode || "INTERNAL_SERVER_ERROR");
  return {
    ...error,
    extensions: {
      ...error.extensions,
      ...(conflict ? { reason: "IDEMPOTENCY_CONFLICT" } : {}),
      ...(rejected && !declared && !conflict ? { reason: `BOARD_GAME_${rejected.reason}` } : {}),
      code,
    },
  };
}
