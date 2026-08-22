// GraphQL resolver — BMS dashboard + RBAC management (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getDashboard, getInventoryActionCenter, getOperationalAlerts } from "@/lib/bms/dashboard";
import { getAiFailureSummary } from "@/lib/bms/aiUsage";
import { getTenantId } from "@/lib/bms/tenant";
import {
  requirePermission,
  loadPermissions,
  myPermissions,
  BMS_PERMISSIONS,
  listRolesWithPermissions,
  setRolePermissions,
} from "@/lib/bms/permissions";
import { audit, listAudit } from "@/lib/bms/audit";
import { getActionMetrics, listActions, recordDemandEvent, refreshActions, transitionAction, upsertInventoryPolicy } from "@/lib/bms/actionCenter";

// จัดการ RBAC ได้เฉพาะ Administrator (super)
function requireSuper(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin" || ctx?.admin?.role !== "Administrator") {
    throw new GraphQLError("เฉพาะ Administrator เท่านั้นที่จัดการสิทธิ์ได้", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
}

export const bmsDashboardResolvers = {
  Query: {
    async bmsDashboard(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getDashboard(getTenantId(ctx));
    },
    async bmsOperationalAlerts(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getOperationalAlerts(getTenantId(ctx));
    },
    async bmsInventoryActionCenter(
      _p: unknown,
      args: { windowDays?: number; coverageDays?: number; limit?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "report.view");
      return getInventoryActionCenter(
        getTenantId(ctx),
        args.windowDays ?? 30,
        args.coverageDays ?? 30,
        args.limit ?? 5
      );
    },
    async bmsAiFailureSummary(_p: unknown, args: { days?: number }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getAiFailureSummary(getTenantId(ctx), args.days ?? 7);
    },
    async bmsActions(_p: unknown, args: { limit?: number }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return listActions(getTenantId(ctx), args.limit ?? 50);
    },
    async bmsActionMetrics(_p: unknown, args: { days?: number }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getActionMetrics(getTenantId(ctx), args.days ?? 30);
    },
    // สิทธิ์ของ admin ปัจจุบัน (สำหรับ UI ซ่อน/แสดงปุ่ม)
    async myBmsPermissions(_p: unknown, _a: unknown, ctx: any) {
      return myPermissions(ctx);
    },
    bmsPermissionCatalog() {
      return [...BMS_PERMISSIONS];
    },
    async bmsRolePermissions(_p: unknown, _a: unknown, ctx: any) {
      requireSuper(ctx);
      return listRolesWithPermissions(getTenantId(ctx));
    },
    async bmsAuditLog(_p: unknown, args: { limit?: number }, ctx: any) {
      requireSuper(ctx);
      return listAudit(getTenantId(ctx), args.limit ?? 100);
    },
  },
  Mutation: {
    async bmsRefreshActions(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "action.manage");
      return refreshActions(getTenantId(ctx));
    },
    async bmsTransitionAction(_p: unknown, args: any, ctx: any) {
      await requirePermission(ctx, "action.manage");
      const actor = String(requireAuth(ctx).author_id);
      try {
        return await transitionAction(getTenantId(ctx), args.id, actor, args.status, args.reason, args.ownerId, args.measuredOutcome);
      } catch (err: any) {
        throw new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsRecordInventoryDemand(_p: unknown, args: any, ctx: any) {
      await requirePermission(ctx, "action.manage");
      const actor = String(requireAuth(ctx).author_id);
      try { return await recordDemandEvent(getTenantId(ctx), actor, args.input); }
      catch (err: any) { throw new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } }); }
    },
    async bmsUpsertInventoryPolicy(_p: unknown, args: any, ctx: any) {
      await requirePermission(ctx, "action.manage");
      const actor = String(requireAuth(ctx).author_id);
      try { return await upsertInventoryPolicy(getTenantId(ctx), actor, args.input); }
      catch (err: any) { throw new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } }); }
    },
    async bmsSetRolePermissions(
      _p: unknown,
      args: { roleId: string; permissions: string[] },
      ctx: any
    ) {
      requireSuper(ctx);
      try {
        const ok = await setRolePermissions(getTenantId(ctx), args.roleId, args.permissions);
        if (ok) await audit(ctx, "rbac.set", args.roleId, { count: args.permissions.length });
        return ok;
      } catch (err: any) {
        throw err instanceof GraphQLError
          ? err
          : new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },

  // couponSummary มาจาก getDashboard() เสมอ แต่โชว์ได้เฉพาะ role ที่มี coupon.view (เช่น Sales มี
  // report.view แต่ไม่มี coupon.view — margin-sensitive เหมือนหน้า /admin/coupons เอง) mask เป็น
  // null ที่นี่แทนที่จะ throw กัน bmsDashboard ทั้ง query พังสำหรับ role ที่ไม่ควรเห็นแค่ field เดียว
  BmsDashboard: {
    async couponSummary(parent: any, _a: unknown, ctx: any) {
      const perms = await loadPermissions(ctx);
      return perms.has("coupon.view") ? parent.couponSummary : null;
    },
  },

  // pg คืน created_at เป็น Date object — ต้องแปลงเป็น ISO string เอง (ไม่งั้น
  // GraphQLString.serialize เรียก .valueOf() ได้ epoch number ผิดรูปแบบ → frontend
  // new Date(...) ได้ Invalid Date, pattern เดียวกับ bmsInbox.ts/bmsOrders.ts)
  BmsAuditEntry: {
    created_at: (p: any) => (p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at)),
  },
};
