// =============================================================
// GraphQL resolvers — BMS Reports (admin)
// -------------------------------------------------------------
// report tools แยกส่วน (sales summary ตามช่วงวันที่ / inventory / top sellers)
// ใช้ service เดียวกับที่อื่น (lib/bms/reports) — permission report.view
// =============================================================

import { getSalesSummary, getInventorySummary, getTopSellingProducts } from "@/lib/bms/reports";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";

export const bmsReportsResolvers = {
  Query: {
    async bmsSalesSummary(_p: unknown, args: { from?: string; to?: string }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getSalesSummary(getTenantId(ctx), args.from ?? null, args.to ?? null);
    },

    async bmsInventorySummary(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getInventorySummary(getTenantId(ctx));
    },

    async bmsTopSellingProducts(_p: unknown, args: { from?: string; to?: string; limit?: number }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getTopSellingProducts(getTenantId(ctx), args.from ?? null, args.to ?? null, args.limit ?? 10);
    },
  },
};
