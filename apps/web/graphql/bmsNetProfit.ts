import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { getNetProfitReport } from "@/lib/bms/netProfit";

export const bmsNetProfitResolvers = { Query: {
  async bmsNetProfit(_parent: unknown, args: { month: string }, ctx: any) {
    for (const permission of ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"] as const)
      await requirePermission(ctx, permission);
    const actor = String(requireAuth(ctx).author_id), tenant = getTenantId(ctx);
    try { return await getNetProfitReport(tenant, actor, args.month); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code.endsWith("FORBIDDEN") || code.endsWith("ALL_BRANCH_ACCESS_REQUIRED"))
        throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
      if (!["NET_PROFIT_", "COST_", "SALES_EVIDENCE_"].some(prefix => code.startsWith(prefix))) throw error;
      return { status: "REJECTED", errorCode: code };
    }
  },
} };
