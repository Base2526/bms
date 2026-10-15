import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { previewRestaurantPricePlan } from "@/lib/bms/restaurantPricePlans";
export const bmsRestaurantPricePlanResolvers = {
  Query: {
    async bmsRestaurantPricePlan(_p: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "product.view");
      await requirePermission(ctx, "report.view");
      return previewRestaurantPricePlan(getTenantId(ctx), args.input,String(requireAuth(ctx).author_id));
    },
  },
};
