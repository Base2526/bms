import { GraphQLError } from "graphql/error";
import { audit } from "@/lib/bms/audit";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import {
  canAccessRestockSubscription,
  cancelRestockSubscription,
  countReadyRestockSubscriptions,
  countRestockSubscriptionsByStatus,
  listRestockDeliveries,
  listRestockSubscriptions,
  sendAllReadyRestockNotifications,
  sendRestockNotification,
} from "@/lib/bms/restockSubscriptions";

const assignedScope = (ctx: any) => ctx?.admin?.role === "Sales" ? String(ctx.admin.id) : null;
const actorOf = (ctx: any) => ctx?.admin?.email || ctx?.admin?.id || "admin";

async function requireAccess(ctx: any, id: string) {
  const allowed = await canAccessRestockSubscription(getTenantId(ctx), id, assignedScope(ctx));
  if (!allowed) {
    throw new GraphQLError("ไม่พบรายการแจ้งเตือนหรือไม่มีสิทธิ์เข้าถึง", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
}

export const bmsRestockSubscriptionsResolvers = {
  Query: {
    async bmsRestockReadyCount(_p: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return countReadyRestockSubscriptions(getTenantId(ctx), assignedScope(ctx));
    },
    async bmsRestockSubscriptions(
      _p: unknown,
      args: { status?: string; search?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "inbox.view");
      return listRestockSubscriptions(getTenantId(ctx), { ...args, assignedTo: assignedScope(ctx) });
    },
    async bmsRestockDeliveries(_p: unknown, args: { subscriptionId: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      await requireAccess(ctx, args.subscriptionId);
      return listRestockDeliveries(getTenantId(ctx), args.subscriptionId);
    },
    async bmsRestockStatusCounts(_p: unknown, args: { search?: string }, ctx: any) {
      await requirePermission(ctx, "inbox.view");
      return countRestockSubscriptionsByStatus(getTenantId(ctx), { search: args.search, assignedTo: assignedScope(ctx) });
    },
  },
  Mutation: {
    async bmsSendRestockNotification(
      _p: unknown,
      args: { id: string; body: string },
      ctx: any
    ) {
      await requirePermission(ctx, "inbox.reply");
      await requireAccess(ctx, args.id);
      const result = await sendRestockNotification(getTenantId(ctx), args.id, args.body, actorOf(ctx));
      await audit(ctx, "restock.send", args.id, { status: result.status, delivered: result.delivered });
      return result;
    },
    async bmsCancelRestockSubscription(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "inbox.manage");
      await requireAccess(ctx, args.id);
      const ok = await cancelRestockSubscription(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "restock.cancel", args.id);
      return ok;
    },
    async bmsSendAllReadyRestockNotifications(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "inbox.reply");
      const result = await sendAllReadyRestockNotifications(getTenantId(ctx), actorOf(ctx), assignedScope(ctx));
      await audit(ctx, "restock.send_all", null, result);
      return result;
    },
  },
};
