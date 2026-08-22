// GraphQL resolver — BMS sales report subscriptions (digest ส่งอีเมล/Slack/LINE)
// ฝั่งร้าน (requireTenantAdmin, เหมือน bmsChannels/bmsStoreProfile) + ฝั่ง platform admin
// (requirePlatformAdmin, cross-tenant overview — เหมือน bmsTenants ใน bmsSaas.ts)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { requirePlatformAdmin } from "@/lib/bms/platform";
import { audit } from "@/lib/bms/audit";
import {
  getReportSubscription,
  upsertReportSubscription,
  listReportSubscriptions,
  listReportDeliveries,
  sendTestDigest,
  type UpsertReportSubscriptionInput,
} from "@/lib/bms/reportDigest";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

export const bmsReportScheduleResolvers = {
  Query: {
    async bmsReportSubscription(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return getReportSubscription(getTenantId(ctx));
    },
    async bmsReportDeliveries(_p: unknown, args: { limit?: number }, ctx: any) {
      requireTenantAdmin(ctx);
      return listReportDeliveries(getTenantId(ctx), args.limit ?? 50);
    },
    // ===== Platform admin — ข้ามร้าน =====
    async bmsReportSubscriptions(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listReportSubscriptions();
    },
    async bmsReportDeliveriesForTenant(_p: unknown, args: { tenantId: string; limit?: number }, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listReportDeliveries(args.tenantId, args.limit ?? 50);
    },
  },
  Mutation: {
    async bmsUpsertReportSubscription(_p: unknown, args: { input: UpsertReportSubscriptionInput }, ctx: any) {
      requireTenantAdmin(ctx);
      try {
        const sub = await upsertReportSubscription(getTenantId(ctx), args.input);
        await audit(ctx, "report.subscription.upsert", null, {
          frequency: sub.frequency, enabled: sub.enabled,
          emailEnabled: sub.emailEnabled, slackEnabled: sub.slackEnabled, lineEnabled: sub.lineEnabled,
        });
        return sub;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "บันทึกไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsSendTestReportNow(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      try {
        const result = await sendTestDigest(getTenantId(ctx));
        await audit(ctx, "report.subscription.test", null, { overallStatus: result.overallStatus });
        return result;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "ส่งทดสอบไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
