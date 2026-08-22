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
import {
  adjustAiCredits,
  getAiUsage,
  listAiCreditLedger,
  listAiUsageBreakdown,
  listRecentAiUsageEvents,
} from "@/lib/bms/aiUsage";
import { listAiProviderHealth, countUnhealthyAiProviders } from "@/lib/bms/aiProviderHealth";
import { audit } from "@/lib/bms/audit";
import { requirePlatformAdmin } from "@/lib/bms/platform";
import { requirePermission } from "@/lib/bms/permissions";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

const EVAL_REF_PATTERN = /^EVAL-[A-Za-z0-9._:-]{1,180}$/;
const AI_FEATURE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

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
    async bmsAiUsageEvents(
      _p: unknown,
      args: { limit?: number; evalRef?: string | null; feature?: string | null },
      ctx: any
    ) {
      // Safe, tenant-scoped observability for the AI Quality/eval surface. This deliberately
      // exposes normalized routing fields only, not prompts, arguments, errors, or raw metadata.
      await requirePermission(ctx, "ai_quality.view");
      const evalRef = args?.evalRef?.trim() || null;
      const feature = args?.feature?.trim() || null;
      if (evalRef && !EVAL_REF_PATTERN.test(evalRef)) {
        throw new GraphQLError("Invalid evalRef", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      if (feature && !AI_FEATURE_PATTERN.test(feature)) {
        throw new GraphQLError("Invalid feature", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      return listRecentAiUsageEvents(getTenantId(ctx), {
        limit: args?.limit ?? 20,
        evalRef,
        feature,
      });
    },
    async bmsAiProviderHealth(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listAiProviderHealth();
    },
    async bmsAiProviderHealthCount(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return countUnhealthyAiProviders();
    },
  },
  Mutation: {
    async bmsSetAiKey(
      _p: unknown,
      args: { apiKey?: string; model?: string; provider?: string },
      ctx: any
    ) {
      requireTenantAdmin(ctx);
      const ok = await setTenantAiKey(getTenantId(ctx), {
        apiKey: args.apiKey,
        model: args.model,
        provider: args.provider,
      });
      await audit(ctx, "ai.set_key", null, {
        provider: args.provider ?? "unchanged",
        model: args.model ?? null,
      });
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
    async bmsTestPlatformAiKey(
      _p: unknown,
      args: { provider?: string | null },
      ctx: any
    ) {
      await requirePlatformAdmin(ctx);
      return testPlatformAiKey(args?.provider ?? null);
    },
    async bmsCheckAllAiProviderHealth(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      // ทดสอบ shared provider/purpose พร้อมกัน (ผลข้างเคียงคือเขียนสถานะจริงลง bms_ai_provider_health
      // ผ่าน testPlatformAiKey() เดิม — ดู aiConfig.ts) แล้วคืน state ล่าสุดให้ client อัปเดตตาราง
      // ในหน้าเดียวโดยไม่ต้อง reload — ผลของแต่ละ provider ไม่ throw ต่อกัน (Promise.allSettled)
      // เพราะ provider หนึ่งพังไม่ควรทำให้อีกสอง provider ไม่ได้ถูกทดสอบ
      await Promise.allSettled(
        (["anthropic", "anthropic-ocr", "deepseek", "qwen"] as const).map((provider) =>
          testPlatformAiKey(provider)
        )
      );
      return listAiProviderHealth();
    },
  },
};
