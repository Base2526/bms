// =============================================================
// GraphQL resolvers — BMS Customer 360 (Inbox right panel)
// -------------------------------------------------------------
// อ่านอย่างเดียว, gate ด้วย customer.view เดียวกับ bmsCustomer เดิม
// service จริงอยู่ที่ lib/bms/customer360.ts ทั้งหมด (ตาม pattern
// bmsOrderJourney ใน bmsOrders.ts — resolver แค่ requirePermission + เรียก service)
// =============================================================

import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import {
  getCustomer360,
  getCustomerTimeline,
  getCustomerInsights,
} from "@/lib/bms/customer360";

export const bmsCustomer360Resolvers = {
  Query: {
    async bmsCustomer360(_p: unknown, args: { customerId: string }, ctx: any) {
      await requirePermission(ctx, "customer.view");
      return getCustomer360(getTenantId(ctx), args.customerId);
    },

    async bmsCustomerTimeline(_p: unknown, args: { customerId: string }, ctx: any) {
      await requirePermission(ctx, "customer.view");
      return getCustomerTimeline(getTenantId(ctx), args.customerId);
    },

    async bmsCustomerInsights(_p: unknown, args: { customerId: string }, ctx: any) {
      await requirePermission(ctx, "customer.view");
      return getCustomerInsights(getTenantId(ctx), args.customerId);
    },
  },
};
