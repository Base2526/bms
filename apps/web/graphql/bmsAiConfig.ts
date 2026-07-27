// GraphQL resolver — BMS AI config (BYOK ต่อร้าน + usage/quota + ทดสอบ key)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import {
  getTenantAiConfigMasked,
  setTenantAiKey,
  removeTenantAiKey,
  testTenantAiKey,
  testPlatformAiKey,
} from "@/lib/bms/aiConfig";
import { adjustAiCredits, getAiUsage, listAiCreditLedger, listAiUsageBreakdown } from "@/lib/bms/aiUsage";
import { audit } from "@/lib/bms/audit";
import { requirePlatformAdmin } from "@/lib/bms/platform";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

export const bmsAiConfigResolvers = {
  Query: {
    async bmsAiConfig(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return getTenantAiConfigMasked(getTenantId(ctx));
    },
    async bmsAiUsage(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return getAiUsage(getTenantId(ctx));
    },
    async bmsAiCreditLedger(_p: unknown, args: { limit?: number }, ctx: any) {
      requireTenantAdmin(ctx);
      return listAiCreditLedger(getTenantId(ctx), args?.limit ?? 20);
    },
    async bmsAiUsageBreakdown(_p: unknown, args: { limit?: number }, ctx: any) {
      requireTenantAdmin(ctx);
      return listAiUsageBreakdown(getTenantId(ctx), args?.limit ?? 12);
    },
  },
  Mutation: {
    async bmsSetAiKey(_p: unknown, args: { apiKey?: string; model?: string }, ctx: any) {
      requireTenantAdmin(ctx);
      const ok = await setTenantAiKey(getTenantId(ctx), { apiKey: args.apiKey, model: args.model });
      await audit(ctx, "ai.set_key", null, { model: args.model ?? null });
      return ok;
    },
    async bmsRemoveAiKey(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const ok = await removeTenantAiKey(getTenantId(ctx));
      await audit(ctx, "ai.remove_key");
      return ok;
    },
    async bmsTestAiKey(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const result = await testTenantAiKey(getTenantId(ctx));
      await audit(ctx, "ai.test_key", null, { ok: result.ok });
      return result;
    },
    async bmsAdjustAiCredits(_p: unknown, args: { amount: number; note?: string | null }, ctx: any) {
      requireTenantAdmin(ctx);
      const ok = await adjustAiCredits(getTenantId(ctx), args.amount, args.note ?? null);
      await audit(ctx, "ai.adjust_credits", null, { amount: args.amount, note: args.note ?? null });
      return ok;
    },
    async bmsTestPlatformAiKey(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return testPlatformAiKey();
    },
  },
};
