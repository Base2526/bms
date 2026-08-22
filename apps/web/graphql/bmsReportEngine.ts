// =============================================================
// GraphQL resolvers — BMS AI Report & Document Generation (MVP core)
// -------------------------------------------------------------
// permission report.view เดียวกับ bmsReports.ts (Sales/Manager/Administrator
// อยู่แล้ว) — generateReport() ทำ validate/audit ของมันเองใน service layer
// =============================================================

import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { generateReport, listGeneratedReports, type GenerateReportInput } from "@/lib/bms/reportEngine";
import { emailGeneratedReport, type EmailReportInput } from "@/lib/bms/reportEmail";

export const bmsReportEngineResolvers = {
  Query: {
    async bmsGeneratedReports(_p: unknown, args: { limit?: number }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return listGeneratedReports(getTenantId(ctx), args.limit ?? 50);
    },
  },
  Mutation: {
    async bmsGenerateReport(_p: unknown, args: { input: GenerateReportInput }, ctx: any) {
      await requirePermission(ctx, "report.view");
      try {
        return await generateReport(getTenantId(ctx), ctx, args.input);
      } catch (err: any) {
        throw new GraphQLError(err?.message || "สร้างรายงานไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },

    // ปุ่ม "ยืนยันส่ง" ของ proposal card (A3, tool email_report) ยิงมาที่นี่ — permission แยกจาก
    // report.view เพราะส่งข้อมูลออกนอกระบบไปยังปลายทางที่พิมพ์มาเอง เสี่ยงกว่าการดู/ดาวน์โหลดภายใน
    async bmsEmailReport(_p: unknown, args: EmailReportInput, ctx: any) {
      await requirePermission(ctx, "report.email");
      try {
        return await emailGeneratedReport(getTenantId(ctx), ctx, args);
      } catch (err: any) {
        throw new GraphQLError(err?.message || "ส่งอีเมลรายงานไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
