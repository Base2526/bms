import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import {
  AI_QUALITY_CATEGORIES,
  AI_QUALITY_OUTCOMES,
  AI_QUALITY_VERDICTS,
  dismissAiQualityCase,
  getAiQualityCase,
  getAiQualityMetrics,
  listAiQualityCases,
  reviewAiQualityCase,
  type AiQualityCategory,
  type AiQualityVerdict,
} from "@/lib/bms/aiQuality";
import { audit } from "@/lib/bms/audit";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";

const CASE_STATUSES = ["PENDING", "REVIEWED", "DISMISSED"] as const;
const CASE_SOURCES = ["AUTO_FAILURE", "AUTO_SAMPLE", "MANUAL"] as const;

function optionalEnum(value: unknown, allowed: readonly string[], label: string): string | null {
  if (value == null || value === "") return null;
  const normalized = String(value).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new GraphQLError(`${label} ไม่ถูกต้อง`, {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
  return normalized;
}

function badInput(error: unknown): never {
  throw new GraphQLError(error instanceof Error ? error.message : "บันทึกผลตรวจไม่สำเร็จ", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

export const bmsAiQualityResolvers = {
  Query: {
    async bmsAiQualityMetrics(_p: unknown, args: { days?: number }, ctx: any) {
      await requirePermission(ctx, "ai_quality.view");
      return getAiQualityMetrics(getTenantId(ctx), args.days ?? 30);
    },
    async bmsAiQualityCases(
      _p: unknown,
      args: {
        days?: number;
        status?: string | null;
        source?: string | null;
        outcome?: string | null;
        limit?: number;
        offset?: number;
      },
      ctx: any
    ) {
      await requirePermission(ctx, "ai_quality.view");
      return listAiQualityCases(getTenantId(ctx), {
        days: args.days,
        status: optionalEnum(args.status, CASE_STATUSES, "สถานะ"),
        source: optionalEnum(args.source, CASE_SOURCES, "แหล่งเคส"),
        outcome: optionalEnum(args.outcome, AI_QUALITY_OUTCOMES, "ผล signal"),
        limit: args.limit,
        offset: args.offset,
      });
    },
    async bmsAiQualityCase(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "ai_quality.view");
      return getAiQualityCase(getTenantId(ctx), args.id);
    },
  },
  Mutation: {
    async bmsReviewAiQualityCase(
      _p: unknown,
      args: { id: string; verdict: string; category: string; note?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "ai_quality.review");
      const verdict = optionalEnum(args.verdict, AI_QUALITY_VERDICTS, "ผลตรวจ") as AiQualityVerdict;
      const category = optionalEnum(args.category, AI_QUALITY_CATEGORIES, "หมวดปัญหา") as AiQualityCategory;
      if (!verdict || !category) {
        throw new GraphQLError("ต้องระบุผลตรวจและหมวดปัญหา", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      const auth = requireAuth(ctx);
      try {
        const result = await reviewAiQualityCase(getTenantId(ctx), args.id, {
          verdict,
          category,
          note: args.note,
          reviewerId: String(auth.author_id),
        });
        await audit(ctx, "ai_quality.review", args.id, { verdict, category });
        return result;
      } catch (error) {
        badInput(error);
      }
    },
    async bmsDismissAiQualityCase(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "ai_quality.review");
      const auth = requireAuth(ctx);
      try {
        const result = await dismissAiQualityCase(
          getTenantId(ctx),
          args.id,
          String(auth.author_id)
        );
        await audit(ctx, "ai_quality.dismiss", args.id);
        return result;
      } catch (error) {
        badInput(error);
      }
    },
  },
};
