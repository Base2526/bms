// GraphQL resolver — BMS dashboard + RBAC management (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getDashboard } from "@/lib/bms/dashboard";
import {
  requirePermission,
  myPermissions,
  BMS_PERMISSIONS,
  listRolesWithPermissions,
  setRolePermissions,
} from "@/lib/bms/permissions";

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
      return getDashboard();
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
      return listRolesWithPermissions();
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
        return await setRolePermissions(args.roleId, args.permissions);
      } catch (err: any) {
        throw err instanceof GraphQLError
          ? err
          : new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
