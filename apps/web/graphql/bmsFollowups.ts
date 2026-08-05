// GraphQL resolver — BMS Follow-up Automation (rule management + queue/history)
// permission แบบเดียวกับ bmsCoupons.ts: followup.view (อ่าน) / followup.manage (แก้)
import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { runDueFollowups } from "@/lib/bms/followups";
import {
  listFollowupRules,
  upsertFollowupRule,
  deleteFollowupRule,
  type FollowupRuleInput,
} from "@/lib/bms/followups";
import { query } from "@/lib/db";

export const bmsFollowupsResolvers = {
  Query: {
    async bmsFollowupRules(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "followup.view");
      return listFollowupRules(getTenantId(ctx));
    },
    async bmsFollowupQueue(_p: unknown, args: { limit?: number }, ctx: any) {
      await requirePermission(ctx, "followup.view");
      const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
      const res = await query(
        `SELECT j.id, j.status, j.next_run_at, j.retry_count, j.last_result, j.created_at, j.updated_at,
                j.conversation_id, j.rule_id, r.intent, r.message_goal
           FROM bms_followup_jobs j
           JOIN bms_followup_rules r ON r.id = j.rule_id
          WHERE j.tenant_id = $1
          ORDER BY j.updated_at DESC
          LIMIT $2`,
        [getTenantId(ctx), limit]
      );
      return res.rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        nextRunAt: new Date(r.next_run_at).toISOString(),
        retryCount: r.retry_count,
        lastResult: r.last_result,
        conversationId: r.conversation_id,
        ruleId: r.rule_id,
        intent: r.intent,
        messageGoal: r.message_goal,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    },
    async bmsFollowupHistory(_p: unknown, args: { conversationId?: string; limit?: number }, ctx: any) {
      await requirePermission(ctx, "followup.view");
      const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
      const tenantId = getTenantId(ctx);
      const rows = args.conversationId
        ? await query(
            `SELECT * FROM bms_followup_history WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC LIMIT $3`,
            [tenantId, args.conversationId, limit]
          )
        : await query(`SELECT * FROM bms_followup_history WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`, [tenantId, limit]);
      return rows.rows.map((r: any) => ({
        id: r.id,
        jobId: r.job_id,
        conversationId: r.conversation_id,
        ruleId: r.rule_id,
        outcome: r.outcome,
        reason: r.reason,
        messageBody: r.message_body,
        goal: r.goal,
        createdAt: new Date(r.created_at).toISOString(),
      }));
    },
  },
  Mutation: {
    async bmsUpsertFollowupRule(_p: unknown, args: { input: FollowupRuleInput }, ctx: any) {
      await requirePermission(ctx, "followup.manage");
      try {
        const rule = await upsertFollowupRule(getTenantId(ctx), args.input);
        await audit(ctx, "followup.rule_upsert", rule.id, { intent: rule.intent, goal: rule.messageGoal, enabled: rule.enabled });
        return rule;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "บันทึกไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsDeleteFollowupRule(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "followup.manage");
      const ok = await deleteFollowupRule(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "followup.rule_delete", args.id, {});
      return ok;
    },
    // manual trigger for testing — same idea as bmsSendTestReportNow
    async bmsRunFollowupsNow(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "followup.manage");
      const result = await runDueFollowups(getTenantId(ctx));
      await audit(ctx, "followup.run_now", null, result);
      return result;
    },
  },
};
