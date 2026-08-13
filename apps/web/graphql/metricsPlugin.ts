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
