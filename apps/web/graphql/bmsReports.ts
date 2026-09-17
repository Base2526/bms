// =============================================================
// GraphQL resolvers — BMS Reports (admin)
// -------------------------------------------------------------
// report tools แยกส่วน (sales summary ตามช่วงวันที่ / inventory / top sellers)
// ใช้ service เดียวกับที่อื่น (lib/bms/reports) — permission report.view
// =============================================================

import {
  getInventorySummary,
  getManagementReport,
  getSalesSummary,
  getTopSellingProducts,
} from "@/lib/bms/reports";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";

export const bmsReportsResolvers = {
  Query: {
    async bmsSalesSummary(_p: unknown, args: { from?: string; to?: string; locationId?: string }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getSalesSummary(getTenantId(ctx), args.from ?? null, args.to ?? null, args.locationId ?? null);
    },

    async bmsInventorySummary(_p: unknown, args: { locationId?: string }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getInventorySummary(getTenantId(ctx), args.locationId ?? null);
    },

    async bmsTopSellingProducts(
      _p: unknown,
      args: { from?: string; to?: string; limit?: number; locationId?: string },
      ctx: any
    ) {
      await requirePermission(ctx, "report.view");
      return getTopSellingProducts(
        getTenantId(ctx),
        args.from ?? null,
        args.to ?? null,
        args.limit ?? 10,
        args.locationId ?? null
      );
    },

    async bmsManagementReport(
      _p: unknown,
      args: { from?: string; to?: string; locationId?: string },
      ctx: any
    ) {
      await requirePermission(ctx, "report.view");
      return getManagementReport(
        getTenantId(ctx),
        args.from ?? null,
        args.to ?? null,
        args.locationId ?? null
      );
    },
  },
};
