// =============================================================
// GraphQL resolvers — BMS Customer 360 (Inbox right panel)
// -------------------------------------------------------------
// อ่านอย่างเดียว, gate ด้วย customer.view เดียวกับ bmsCustomer เดิม
// service จริงอยู่ที่ lib/bms/customer360.ts ทั้งหมด (ตาม pattern
// bmsOrderJourney ใน bmsOrders.ts — resolver แค่ requirePermission + เรียก service)
// =============================================================

import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { query } from "@/lib/db";
import {
  getCustomer360,
  getCustomerTimeline,
  getCustomerInsights,
} from "@/lib/bms/customer360";

export const bmsCustomer360Resolvers = {
  Query: {
    async bmsCustomer360(
      _p: unknown,
      args: { customerId?: string | null; channel?: string | null; customerRef?: string | null; conversationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "customer.view");
      const tenantId = getTenantId(ctx);
      let customerId = args.customerId ?? null;
      let channel = args.channel ?? null;
      let customerRef = args.customerRef ?? null;

      if (args.conversationId) {
        const conv = await query<{ customer_id: string | null; channel: string; customer_ref: string | null }>(
          `SELECT customer_id, channel, customer_ref
             FROM bms_conversations
            WHERE tenant_id = $1 AND id = $2
            LIMIT 1`,
          [tenantId, args.conversationId]
        );
        if (conv.rows[0]) {
          customerId = conv.rows[0].customer_id ?? customerId;
          channel = conv.rows[0].channel ?? channel;
          customerRef = conv.rows[0].customer_ref ?? customerRef;
        }
      }

      if (!customerId && !channel && !customerRef) {
        return {
          customer: null,
          identities: [],
          addresses: [],
          stats: {
            lifetimeValue: 0,
            totalOrders: 0,
            avgOrderValue: 0,
            completedOrders: 0,
            cancelledOrders: 0,
            refundCount: 0,
            lastOrderDate: null,
            lastConversationAt: null,
            avgResponseTimeSeconds: null,
          },
          recentOrders: [],
          products: { topPurchased: [], recentlyPurchased: [], frequentlyPurchased: [], favoriteCategories: [] },
          draftOrder: null,
          notes: [],
          coupons: [],
        };
      }

      return getCustomer360(tenantId, customerId ?? "", {
        channel,
        customerRef,
      });
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
