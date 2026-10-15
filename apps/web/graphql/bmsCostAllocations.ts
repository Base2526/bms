import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { getCostAllocationReport, previewCostAllocation, saveCostAllocation } from "@/lib/bms/costAllocations";

async function run(ctx: any, write: boolean, operation: (tenant: string, actor: string) => Promise<unknown>) {
  for (const permission of ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"] as const)
    await requirePermission(ctx, permission);
  if (write) await requirePermission(ctx, "expense.manage");
  const actor = String(requireAuth(ctx).author_id), tenant = getTenantId(ctx);
  try { return await operation(tenant, actor); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.endsWith("FORBIDDEN") || code === "COST_ALLOCATION_ALL_BRANCH_ACCESS_REQUIRED")
      throw new GraphQLError(code, { extensions: { code: "FORBIDDEN" } });
    if (!code.startsWith("COST_") && !code.startsWith("SALES_EVIDENCE_")) throw error;
    return { status: "REJECTED", errorCode: code };
  }
}
export const bmsCostAllocationResolvers = {
  Query: {
    bmsCostAllocations: (_: unknown, args: { month: string }, ctx: any) => run(ctx, false,
      (tenant, actor) => getCostAllocationReport(tenant, actor, args.month)),
    bmsPreviewCostAllocation: (_: unknown, args: { input: unknown }, ctx: any) => run(ctx, false,
      (tenant, actor) => previewCostAllocation(tenant, actor, args.input)),
  },
  Mutation: {
    bmsSaveCostAllocation: (_: unknown, args: { input: unknown }, ctx: any) => run(ctx, true,
      (tenant, actor) => saveCostAllocation(tenant, actor, args.input)),
  },
};
