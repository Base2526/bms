// GraphQL resolver — BMS dashboard + RBAC management (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getDashboard } from "@/lib/bms/dashboard";
import { getTenantId } from "@/lib/bms/tenant";
import {
  requirePermission,
  myPermissions,
  BMS_PERMISSIONS,
  listRolesWithPermissions,
  setRolePermissions,
} from "@/lib/bms/permissions";
import { audit, listAudit } from "@/lib/bms/audit";

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

  // pg คืน created_at เป็น Date object — ต้องแปลงเป็น ISO string เอง (ไม่งั้น
  // GraphQLString.serialize เรียก .valueOf() ได้ epoch number ผิดรูปแบบ → frontend
  // new Date(...) ได้ Invalid Date, pattern เดียวกับ bmsInbox.ts/bmsOrders.ts)
  BmsAuditEntry: {
    created_at: (p: any) => (p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at)),
  },
};
