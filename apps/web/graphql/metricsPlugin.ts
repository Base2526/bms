// =============================================================
// Apollo plugin — บันทึก latency + error ของทุก GraphQL operation
// -------------------------------------------------------------
// เสียบจุดเดียวที่ ApolloServer แล้วครอบคลุมทั้ง admin UI/AI assistant/eval
// เพราะ business logic ของ BMS ไหลผ่าน GraphQL เกือบทั้งหมด (เหตุผลเดียวกับที่
// createContext() เป็น choke point ของ session revocation)
//
// วัดจาก requestDidStart → willSendResponse จึงเป็น "เวลาที่ Apollo ใช้ทำงาน"
// (parse/validate/execute) ไม่รวม network ฝั่ง client และไม่รวมเวลาที่ Next.js
// ใช้ก่อนเข้ามาถึง handler
// =============================================================

import type { ApolloServerPlugin, BaseContext, GraphQLRequestListener } from "@apollo/server";
import { recordRequestMetric } from "@/lib/bms/requestMetrics";
import { writeLogServer } from "@/lib/log/writeLog.server";
import { ERROR_WINDOW_MS, EXPECTED_WINDOW_MS, shouldLog } from "@/lib/log/logThrottle";

// error ที่ "ตั้งใจให้เกิด" — ผู้ใช้กรอกผิด/ไม่มีสิทธิ์/หมดอายุ ไม่ใช่ระบบพัง
// เก็บไว้อ่านย้อนหลังได้เหมือนกัน แต่เป็น warn เพื่อไม่ให้ไปปลุก Slack alert
// (alertSlackServer ยิงเมื่อ level=error ครบ threshold) และไม่กลบของจริง
const EXPECTED_CODES = new Set([
  "BAD_USER_INPUT",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "GRAPHQL_VALIDATION_FAILED",
  "GRAPHQL_PARSE_FAILED",
  "BAD_REQUEST",
  "PERSISTED_QUERY_NOT_FOUND",
]);

export function metricsPlugin<TContext extends BaseContext>(): ApolloServerPlugin<TContext> {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<TContext>> {
      const startedAt = Date.now();
      let errorCode: string | null = null;
      let hadError = false;

      return {
        async didEncounterErrors(requestContext) {
          hadError = true;
          // เก็บ code แรกพอ — 1 request ที่พังมักพังด้วยเหตุเดียว และ field นี้
          // ใช้จัดกลุ่มภาพรวม ไม่ใช่ debug รายเคส (รายเคสดูที่ system_logs เดิม)
          const first = requestContext.errors?.[0];
          const code = first?.extensions?.code;
          errorCode = typeof code === "string" ? code : "INTERNAL_SERVER_ERROR";

          // เขียนรายเคสลง system_logs ด้วย: metric ข้างล่างเป็นแค่ตัวนับ ไม่บอกว่า
          // "พังว่าอะไร" · เดิม error ฝั่ง GraphQL ถูกบันทึกก็ต่อเมื่อมีเบราว์เซอร์
          // แอดมินเปิดอยู่แล้ว errorLink ยิง /api/logs ให้ — งาน cron/AI/mobile
          // ที่พังจึงไม่เหลือร่องรอยเลย
          const operationName =
            requestContext.operationName || requestContext.operation?.name?.value || "anonymous";
          const expected = EXPECTED_CODES.has(String(errorCode));
          const level = expected ? "warn" : "error";
          // error เดียวกันรัว ๆ ไม่ต้องเขียนทุกครั้ง — จำนวนครั้งนับครบอยู่แล้วที่
          // recordRequestMetric ข้างล่าง (403 ทุกครั้งที่โหลดหน้าเป็นเรื่องปกติมาก)
          if (
            !shouldLog(
              `gql|${operationName}|${errorCode}`,
              expected ? EXPECTED_WINDOW_MS : ERROR_WINDOW_MS
            )
          ) {
            return;
          }
          // ไม่ใส่ variables: มีทั้งรหัสผ่าน token และข้อมูลลูกค้าปนอยู่
          void writeLogServer(level, "graphql", `${operationName}: ${first?.message ?? "unknown error"}`, {
            action: "graphql.error",
            status: String(errorCode),
            routeName: `gql:${operationName}`,
            errorMessage: first?.message ?? null,
            stack: first?.stack ?? null,
            path: first?.path ? first.path.join(".") : null,
          });
        },
        async willSendResponse(requestContext) {
          const operationName =
            requestContext.operationName || requestContext.operation?.name?.value || "anonymous";
          recordRequestMetric({
            name: `gql:${operationName}`,
            durationMs: Date.now() - startedAt,
            ok: !hadError,
            errorCode,
          });
        },
      };
    },
  };
}
