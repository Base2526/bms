// GraphQL resolver — BMS SaaS: signup (public) + billing (admin)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { listPlans, getTenantPlan, getUsage, changePlan } from "@/lib/bms/plans";
import { signupShop } from "@/lib/bms/signup";
import { audit } from "@/lib/bms/audit";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

export const bmsSaasResolvers = {
  Query: {
    async bmsBilling(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const tid = getTenantId(ctx);
      const [plan, usage, plans] = await Promise.all([getTenantPlan(tid), getUsage(tid), listPlans()]);
      return { plan, usage, plans };
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
  },
};
