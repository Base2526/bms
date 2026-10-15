import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { previewRestaurantMenuPlan } from "@/lib/bms/restaurantMenuPlans";
export const bmsRestaurantMenuPlanResolvers = {
  Query: {
    async bmsRestaurantMenuPlan(_p: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "product.view");
      await requirePermission(ctx, "report.view");
      return previewRestaurantMenuPlan(getTenantId(ctx), args.input);
    },
  },
};
