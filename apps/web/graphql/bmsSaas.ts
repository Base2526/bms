// GraphQL resolver — BMS SaaS: signup (public) + billing (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getTenantId } from "@/lib/bms/tenant";
import { myPermissions } from "@/lib/bms/permissions";
import { listPlans, getTenantPlan, getUsage, changePlan } from "@/lib/bms/plans";
import { signupShop } from "@/lib/bms/signup";
import { audit } from "@/lib/bms/audit";
import { isPlatformAdmin, requirePlatformAdmin, listTenants, setTenantActive } from "@/lib/bms/platform";
import { cookies } from "next/headers";
import { signActTenant, ACT_TENANT_COOKIE } from "@/lib/auth/token";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

export const bmsSaasResolvers = {
  Query: {
    // public — ไม่ต้อง auth (โชว์ราคาแพ็กเกจที่หน้าแรก/landing page)
    async bmsPublicPlans() {
      return listPlans();
    },
    async bmsBilling(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const tid = getTenantId(ctx);
      const [plan, usage, plans] = await Promise.all([getTenantPlan(tid), getUsage(tid), listPlans()]);
      return { plan, usage, plans };
    },

    // ===== โปรไฟล์ของ admin ที่ล็อกอินอยู่ (อ่านสดจาก DB) =====
    async bmsMe(_p: unknown, _a: unknown, ctx: any) {
      const auth = requireAuth(ctx);
      if (auth.scope !== "admin") {
        throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
      }
      const u = await query<any>(
        `SELECT id, name, username, email, phone, avatar, role, language,
                tenant_id, is_platform_admin, is_available, created_at
           FROM users WHERE id = $1`,
        [auth.author_id]
      );
      const user = u.rows[0];
      if (!user) {
        throw new GraphQLError("ไม่พบผู้ใช้", { extensions: { code: "NOT_FOUND", http: { status: 404 } } });
      }
      let tenant = null;
      if (user.tenant_id) {
        const t = await query<any>(
          `SELECT id, name, slug, plan FROM bms_tenants WHERE id = $1`,
          [user.tenant_id]
        );
        tenant = t.rows[0] ?? null;
      }
      const permissions = await myPermissions(ctx);
      return {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        language: user.language,
        is_platform_admin: user.is_platform_admin === true,
        is_available: user.is_available !== false,
        // pg คืน Date object — ต้องแปลงเป็น ISO string เอง (ไม่งั้น GraphQLString.serialize จะได้ epoch number ผิดรูปแบบ)
        created_at: user.created_at instanceof Date ? user.created_at.toISOString() : (user.created_at ?? null),
        tenant,
        permissions,
      };
    },

    // ===== Platform admin (เจ้าของแพลตฟอร์ม — ข้ามร้าน) =====
    async bmsIsPlatformAdmin(_p: unknown, _a: unknown, ctx: any) {
      return isPlatformAdmin(ctx);
    },
    async bmsTenants(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listTenants();
    },
    // ร้านที่ platform admin กำลัง "เข้าดู" อยู่ (null = ไม่ได้ impersonate) — ใช้โชว์ banner
    async bmsActingTenant(_p: unknown, _a: unknown, ctx: any) {
      const actId = ctx?.admin?.__actingTenantId;
      if (!actId) return null;
      const r = await query<any>(`SELECT id, name, slug FROM bms_tenants WHERE id = $1`, [actId]);
      return r.rows[0] ?? null;
    },
  },
  Mutation: {
    // public — ไม่ต้อง auth (สมัครใช้งานเอง)
    async bmsSignup(
      _p: unknown,
      args: { shopName: string; name?: string; email: string; password: string }
    ) {
      return signupShop({ shopName: args.shopName, name: args.name, email: args.email, password: args.password });
    },
    async bmsChangePlan(_p: unknown, args: { planCode: string }, ctx: any) {
      requireTenantAdmin(ctx);
      try {
        const ok = await changePlan(getTenantId(ctx), args.planCode);
        if (ok) await audit(ctx, "plan.change", args.planCode);
        return ok;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },

    // ===== Platform admin — จัดการร้านข้ามร้าน =====
    async bmsSetTenantActive(_p: unknown, args: { tenantId: string; active: boolean }, ctx: any) {
      await requirePlatformAdmin(ctx);
      const ok = await setTenantActive(args.tenantId, args.active);
      if (ok) await audit(ctx, args.active ? "tenant.activate" : "tenant.suspend", args.tenantId);
      return ok;
    },
    async bmsSetTenantPlan(_p: unknown, args: { tenantId: string; planCode: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      try {
        const ok = await changePlan(args.tenantId, args.planCode);
        if (ok) await audit(ctx, "tenant.plan.change", args.tenantId, { planCode: args.planCode });
        return ok;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "failed", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },

    // ===== drill-down: platform admin เข้า/ออก มุมร้าน =====
    async bmsEnterTenant(_p: unknown, args: { tenantId: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      const r = await query<any>(`SELECT id FROM bms_tenants WHERE id = $1`, [args.tenantId]);
      if (!r.rowCount) throw new GraphQLError("ไม่พบร้าน", { extensions: { code: "BAD_USER_INPUT" } });
      const adminId = ctx?.admin?.id;
      cookies().set(ACT_TENANT_COOKIE, signActTenant(args.tenantId, adminId), {
        httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
      });
      await audit(ctx, "tenant.impersonate.enter", args.tenantId);
      return true;
    },
    async bmsExitTenant(_p: unknown, _a: unknown, ctx: any) {
      const actId = ctx?.admin?.__actingTenantId;
      cookies().delete(ACT_TENANT_COOKIE);
      if (actId) await audit(ctx, "tenant.impersonate.exit", actId);
      return true;
    },
  },
};
