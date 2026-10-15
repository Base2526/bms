import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { getOperatingCostReport, reviewOperatingCost } from "@/lib/bms/operatingCosts";

async function authorize(ctx: any, write = false) {
  await requirePermission(ctx, "report.view");
  await requirePermission(ctx, "expense.view");
  await requirePermission(ctx, "delivery.settlement.view");
  if (write) await requirePermission(ctx, "expense.manage");
  return String(requireAuth(ctx).author_id);
}
function failure(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (!message.startsWith("COST_")) throw error;
  const code = message === "COST_ALL_BRANCH_ACCESS_REQUIRED" ? "FORBIDDEN"
    : ["COST_REVIEW_CONFLICT", "COST_SOURCE_CHANGED"].includes(message) ? "CONFLICT" : "BAD_USER_INPUT";
  throw new GraphQLError(message, { extensions: { code } });
}
export const bmsOperatingCostResolvers = {
  Query: {
    async bmsOperatingCosts(_p: unknown, args: { month: string }, ctx: any) {
      const actor = await authorize(ctx);
      try { return await getOperatingCostReport(getTenantId(ctx), actor, args.month); } catch (error) { failure(error); }
    },
  },
  Mutation: {
    async bmsReviewOperatingCost(_p: unknown, args: { input: any }, ctx: any) {
      const actor = await authorize(ctx, true);
      try { return await reviewOperatingCost(getTenantId(ctx), actor, args.input); } catch (error) { failure(error); }
    },
  },
};
