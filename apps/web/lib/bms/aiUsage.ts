// =============================================================
// BMS AI usage — monthly quota + usage events + credit ledger
// -------------------------------------------------------------
// เป้าหมาย:
// - shared key / BYOK ใช้ service เดียวกันในการบันทึก usage event
// - monthly quota ถูก enforce แบบ atomic
// - หน้า Billing/Settings อ่าน summary/ledger ได้จาก source of truth เดียวกัน
// =============================================================

import crypto from "crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import { getTenantPlan, type Plan } from "./plans";

function run<T extends QueryResultRow = QueryResultRow>(client: PoolClient | undefined, sql: string, params: any[] = []) {
  return client ? client.query<T>(sql, params) : query<T>(sql, params);
}

export function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type AiUsage = {
  count: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  planCode: string;
  planName: string;
  requestCount: number;
  sharedRequests: number;
  byokRequests: number;
  blockedRequests: number;
  grantedCredits: number;
  bonusCredits: number;
  adjustedCredits: number;
  estimatedCost: number;
};

export type AiUsageContext = {
  surface?: "customer" | "staff" | "system";
  feature?: string;
  channel?: string | null;
  provider?: string;
  model?: string | null;
  meta?: Record<string, unknown>;
};

export type AiUsageEvent = {
  id: string;
  yearMonth: string;
  source: "shared" | "byok" | "none";
  surface: "customer" | "staff" | "system";
  feature: string;
  channel: string | null;
  provider: string;
  model: string | null;
  status: "started" | "completed" | "failed" | "blocked" | "fallback";
  creditsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AiCreditLedgerEntry = {
  id: string;
  yearMonth: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
};

export type AiUsageBreakdownRow = {
  feature: string;
  requests: number;
  creditsUsed: number;
  estimatedCost: number;
};

const DEFAULT_ANTHROPIC_RATE = {
  inputPerMillionUsd: 3,
  outputPerMillionUsd: 15,
};

function priceForModel(model?: string | null) {
  const m = String(model || "").toLowerCase();
  if (m.includes("haiku") && /4[-_.]?5/.test(m)) {
    return { inputPerMillionUsd: 1, outputPerMillionUsd: 5 };
  }
  if (m.includes("haiku")) return { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 };
  if (m.includes("sonnet")) return DEFAULT_ANTHROPIC_RATE;
  if (m.includes("opus")) return { inputPerMillionUsd: 15, outputPerMillionUsd: 75 };
  return DEFAULT_ANTHROPIC_RATE;
}

export function estimateAiCostUsd(inputTokens?: number | null, outputTokens?: number | null, model?: string | null) {
  const inTok = Math.max(0, Number(inputTokens ?? 0));
  const outTok = Math.max(0, Number(outputTokens ?? 0));
  const price = priceForModel(model);
  const inputCost = (inTok / 1_000_000) * price.inputPerMillionUsd;
  const outputCost = (outTok / 1_000_000) * price.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

export function estimateCachedAiCostUsd(
  usage: {
    inputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    outputTokens?: number | null;
  },
  model?: string | null
) {
  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const cacheCreationInputTokens = Math.max(
    0,
    Number(usage.cacheCreationInputTokens ?? 0)
  );
  const cacheReadInputTokens = Math.max(0, Number(usage.cacheReadInputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  const price = priceForModel(model);
  const inputCost =
    ((inputTokens + cacheCreationInputTokens * 1.25 + cacheReadInputTokens * 0.1) /
      1_000_000) *
    price.inputPerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * price.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

type MonthlyUsageRow = {
  count: number;
  shared_requests: number;
  byok_requests: number;
  blocked_requests: number;
  credits_granted: number;
  credits_consumed: number;
  credits_bonus: number;
  credits_adjusted: number;
  estimated_cost: string | number;
};

function planCreditLimit(plan: Plan): number {
  if (typeof plan.ai_credits_monthly === "number") return plan.ai_credits_monthly;
  return plan.max_ai_messages_month;
}

function creditGrantForPlan(plan: Plan): number {
  const limit = planCreditLimit(plan);
  return limit < 0 ? 0 : limit;
}

function balanceFromRow(row: MonthlyUsageRow): number {
  return Math.max((row.credits_granted ?? 0) + (row.credits_bonus ?? 0) + (row.credits_adjusted ?? 0) - (row.credits_consumed ?? 0), 0);
}

async function ensureMonthlySummary(
  client: PoolClient,
  tenantId: string,
  yearMonth: string,
  plan: Plan
): Promise<MonthlyUsageRow> {
  const grant = creditGrantForPlan(plan);
  await client.query(
    `INSERT INTO bms_ai_usage_monthly (
        tenant_id, year_month, count, updated_at,
        shared_requests, byok_requests, blocked_requests,
        credits_granted, credits_consumed, credits_bonus, credits_adjusted,
        estimated_cost, last_event_at
      )
      VALUES ($1, $2, 0, now(), 0, 0, 0, $3, 0, 0, 0, 0, NULL)
      ON CONFLICT (tenant_id, year_month) DO NOTHING`,
    [tenantId, yearMonth, grant]
  );

  await client.query(
    `UPDATE bms_ai_usage_monthly
        SET shared_requests = GREATEST(shared_requests, count),
            credits_consumed = GREATEST(credits_consumed, count),
            credits_granted = CASE
              WHEN $3 >= 0 AND credits_granted = 0 THEN $3
              ELSE credits_granted
            END
      WHERE tenant_id = $1 AND year_month = $2`,
    [tenantId, yearMonth, grant]
  );

  const res = await client.query<MonthlyUsageRow>(
    `SELECT count, shared_requests, byok_requests, blocked_requests,
            credits_granted, credits_consumed, credits_bonus, credits_adjusted, estimated_cost
       FROM bms_ai_usage_monthly
      WHERE tenant_id = $1 AND year_month = $2`,
    [tenantId, yearMonth]
  );
  const row = res.rows[0];

  if (grant > 0) {
    await client.query(
      `INSERT INTO bms_ai_credit_ledger (
          tenant_id, year_month, entry_type, amount, balance_after,
          reference_type, reference_id, note
        )
        VALUES ($1, $2, 'grant', $3, $4, 'monthly_quota', $2, 'Monthly AI credit grant')
        ON CONFLICT (tenant_id, year_month, entry_type, reference_type, reference_id) DO NOTHING`,
      [tenantId, yearMonth, grant, balanceFromRow(row)]
    );
  }

  return row;
}

function normalizeCtx(ctx?: AiUsageContext) {
  return {
    surface: ctx?.surface ?? "customer",
    feature: ctx?.feature ?? "customer_reply",
    channel: ctx?.channel ?? null,
    provider: ctx?.provider ?? "anthropic",
    model: ctx?.model ?? null,
    meta: ctx?.meta ?? {},
  } as const;
}

async function insertUsageEvent(
  client: PoolClient,
  tenantId: string,
  yearMonth: string,
  source: "shared" | "byok" | "none",
  status: "started" | "completed" | "failed" | "blocked" | "fallback",
  creditsUsed: number,
  ctx?: AiUsageContext,
  errorMessage?: string | null
) {
  const normalized = normalizeCtx(ctx);
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO bms_ai_usage_events (
        id, tenant_id, year_month, source, surface, feature, channel,
        provider, model, status, credits_used, error_message, meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      id,
      tenantId,
      yearMonth,
      source,
      normalized.surface,
      normalized.feature,
      normalized.channel,
      normalized.provider,
      normalized.model,
      status,
      creditsUsed,
      errorMessage ?? null,
      JSON.stringify(normalized.meta ?? {}),
    ]
  );
  return id;
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function getAiUsage(tenantId: string): Promise<AiUsage> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  const limit = planCreditLimit(plan);
  const grant = creditGrantForPlan(plan);

  const row = await transaction(async (client) => {
    return ensureMonthlySummary(client, tenantId, yearMonth, plan);
  });

  const remaining = limit < 0 ? -1 : balanceFromRow(row);
  return {
    count: row.credits_consumed ?? row.count ?? 0,
    limit,
    remaining,
    unlimited: limit < 0,
    planCode: plan.code,
    planName: plan.name,
    requestCount: (row.shared_requests ?? 0) + (row.byok_requests ?? 0),
    sharedRequests: row.shared_requests ?? 0,
    byokRequests: row.byok_requests ?? 0,
    blockedRequests: row.blocked_requests ?? 0,
    grantedCredits: row.credits_granted ?? grant,
    bonusCredits: row.credits_bonus ?? 0,
    adjustedCredits: row.credits_adjusted ?? 0,
    estimatedCost: Number(row.estimated_cost ?? 0),
  };
}

export async function recordByokAiUsage(tenantId: string, ctx?: AiUsageContext): Promise<string> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    await client.query(
      `UPDATE bms_ai_usage_monthly
          SET byok_requests = byok_requests + 1,
              last_event_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND year_month = $2`,
      [tenantId, yearMonth]
    );
    return insertUsageEvent(client, tenantId, yearMonth, "byok", "started", 0, ctx);
  });
}

export async function recordAiFallback(tenantId: string, reason: "quota_exhausted" | "no_credentials", ctx?: AiUsageContext): Promise<string> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    await client.query(
      `UPDATE bms_ai_usage_monthly
          SET blocked_requests = blocked_requests + 1,
              last_event_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND year_month = $2`,
      [tenantId, yearMonth]
    );
    return insertUsageEvent(client, tenantId, yearMonth, reason === "quota_exhausted" ? "shared" : "none", "blocked", 0, ctx, reason);
  });
}

/**
 * เช็ค + เพิ่มการใช้งาน AI ผ่าน shared key แบบ atomic
 * คืน ok=false ถ้า quota เดือนนี้หมดแล้ว
 */
export async function tryConsumeAiQuota(
  tenantId: string,
  ctx?: AiUsageContext
): Promise<{ ok: boolean; eventId?: string }> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  const unlimited = planCreditLimit(plan) < 0;

  return transaction(async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);

    if (!unlimited) {
      const upd = await client.query<MonthlyUsageRow>(
        `UPDATE bms_ai_usage_monthly
            SET count = credits_consumed + 1,
                shared_requests = shared_requests + 1,
                credits_consumed = credits_consumed + 1,
                last_event_at = now(),
                updated_at = now()
          WHERE tenant_id = $1
            AND year_month = $2
            AND (credits_granted + credits_bonus + credits_adjusted - credits_consumed) > 0
          RETURNING count, shared_requests, byok_requests, blocked_requests,
                    credits_granted, credits_consumed, credits_bonus, credits_adjusted, estimated_cost`,
        [tenantId, yearMonth]
      );

      if ((upd.rowCount ?? 0) === 0) {
        await client.query(
          `UPDATE bms_ai_usage_monthly
              SET blocked_requests = blocked_requests + 1,
                  last_event_at = now(),
                  updated_at = now()
            WHERE tenant_id = $1 AND year_month = $2`,
          [tenantId, yearMonth]
        );
        const blockedId = await insertUsageEvent(client, tenantId, yearMonth, "shared", "blocked", 0, ctx, "quota_exhausted");
        return { ok: false, eventId: blockedId };
      }

      const row = upd.rows[0];
      const eventId = await insertUsageEvent(client, tenantId, yearMonth, "shared", "started", 1, ctx);
      await client.query(
        `INSERT INTO bms_ai_credit_ledger (
            tenant_id, year_month, entry_type, amount, balance_after,
            reference_type, reference_id, note
          )
          VALUES ($1, $2, 'consume', -1, $3, 'ai_usage_event', $4, $5)`,
        [tenantId, yearMonth, balanceFromRow(row), eventId, normalizeCtx(ctx).feature]
      );
      return { ok: true, eventId };
    }

    const upd = await client.query<MonthlyUsageRow>(
      `UPDATE bms_ai_usage_monthly
          SET count = credits_consumed + 1,
              shared_requests = shared_requests + 1,
              credits_consumed = credits_consumed + 1,
              last_event_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND year_month = $2
        RETURNING count, shared_requests, byok_requests, blocked_requests,
                  credits_granted, credits_consumed, credits_bonus, credits_adjusted, estimated_cost`,
      [tenantId, yearMonth]
    );
    const eventId = await insertUsageEvent(client, tenantId, yearMonth, "shared", "started", 1, ctx);
    return { ok: true, eventId };
  });
}

export async function finalizeAiUsageEvent(
  eventId: string,
  result: {
    status: "completed" | "failed" | "fallback";
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
    errorMessage?: string | null;
    // แยกส่วนของ input token ตาม rate ที่จ่ายจริง (regular 1x / cache write 1.25x / cache read 0.1x)
    // `inputTokens` ยังเป็นผลรวมทั้งสามเหมือนเดิมเพื่อไม่ให้ quota/report ที่อ่านคอลัมน์นี้เปลี่ยนความหมาย
    // — breakdown เก็บลง meta เพื่อให้ตอบได้ว่า prompt caching ทำงานอยู่จริงไหมโดยไม่ต้องแกะกลับจาก cost
    cacheReadInputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
  }
): Promise<void> {
  const inputTokens = result.inputTokens ?? null;
  const outputTokens = result.outputTokens ?? null;
  const cacheReadInputTokens = result.cacheReadInputTokens ?? null;
  const cacheCreationInputTokens = result.cacheCreationInputTokens ?? null;
  // เขียน meta เฉพาะตอน caller รู้ค่าจริง (path ที่ไม่ได้ตั้ง cache_control จะไม่มี key เหล่านี้เลย
  // ซึ่งต่างจากการมี key แล้วเป็น 0 — 0 หมายถึง "ตั้ง cache_control แล้วแต่ไม่ hit")
  const cacheMeta =
    cacheReadInputTokens === null && cacheCreationInputTokens === null
      ? null
      : JSON.stringify({
          cache_read_input_tokens: cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: cacheCreationInputTokens ?? 0,
          regular_input_tokens: Math.max(
            0,
            (inputTokens ?? 0) -
              (cacheReadInputTokens ?? 0) -
              (cacheCreationInputTokens ?? 0)
          ),
        });
  const event = await query<{ tenant_id: string; year_month: string; model: string | null; estimated_cost: string | number }>(
    `SELECT tenant_id, year_month, model, estimated_cost
       FROM bms_ai_usage_events
      WHERE id = $1`,
    [eventId]
  );
  const current = event.rows[0];
  if (!current) return;
  const estimatedCost = Number(result.estimatedCost ?? estimateAiCostUsd(inputTokens, outputTokens, current.model));
  await query(
    `WITH upd AS (
        UPDATE bms_ai_usage_events
           SET status = $2,
               input_tokens = COALESCE($3, input_tokens),
               output_tokens = COALESCE($4, output_tokens),
               estimated_cost = COALESCE($5, estimated_cost),
               error_message = COALESCE($6, error_message),
               meta = meta || COALESCE($7::jsonb, '{}'::jsonb),
               completed_at = now()
         WHERE id = $1
         RETURNING tenant_id, year_month
      )
      UPDATE bms_ai_usage_monthly m
         SET estimated_cost = m.estimated_cost + $5,
             updated_at = now(),
             last_event_at = now()
        FROM upd
       WHERE m.tenant_id = upd.tenant_id
         AND m.year_month = upd.year_month`,
    [
      eventId,
      result.status,
      inputTokens,
      outputTokens,
      estimatedCost,
      result.errorMessage ?? null,
      cacheMeta,
    ]
  );
}

export async function adjustAiCredits(
  tenantId: string,
  amount: number,
  note?: string | null
): Promise<boolean> {
  if (!Number.isInteger(amount) || amount === 0) throw new Error("จำนวนเครดิตต้องเป็นจำนวนเต็มและต้องไม่เป็น 0");
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(async (client) => {
    const row = await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    const nextAdjusted = (row.credits_adjusted ?? 0) + amount;
    const nextBalance = Math.max(balanceFromRow(row) + amount, 0);
    await client.query(
      `UPDATE bms_ai_usage_monthly
          SET credits_adjusted = credits_adjusted + $3,
              updated_at = now(),
              last_event_at = now()
        WHERE tenant_id = $1 AND year_month = $2`,
      [tenantId, yearMonth, amount]
    );
    await client.query(
      `INSERT INTO bms_ai_credit_ledger (
          tenant_id, year_month, entry_type, amount, balance_after,
          reference_type, reference_id, note
        )
        VALUES ($1, $2, 'adjustment', $3, $4, 'manual_adjustment', gen_random_uuid()::text, $5)`,
      [tenantId, yearMonth, amount, nextBalance, note ?? (amount > 0 ? "Manual AI credit top-up" : "Manual AI credit adjustment")]
    );
    return nextAdjusted !== row.credits_adjusted;
  });
}

export async function listAiCreditLedger(tenantId: string, limit = 20): Promise<AiCreditLedgerEntry[]> {
  const ym = currentYearMonth();
  const res = await query<any>(
    `SELECT id, year_month, entry_type, amount, balance_after, reference_type, reference_id, note, created_at
       FROM bms_ai_credit_ledger
      WHERE tenant_id = $1 AND year_month = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [tenantId, ym, Math.max(1, Math.min(limit, 100))]
  );
  return res.rows.map((row) => ({
    id: row.id,
    yearMonth: row.year_month,
    entryType: row.entry_type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type ?? null,
    referenceId: row.reference_id ?? null,
    note: row.note ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export type AiToolFailureRow = { tool: string; outcome: string; count: number };

export type AiFailureSummary = {
  days: number;
  totalToolCalls: number;
  errorCalls: number; // outcome=error|denied
  handoffCount: number; // จำนวนครั้งที่ turn-budget บังคับ handoff (bms_conversation_notes author='AI')
  topFailingTools: AiToolFailureRow[];
};

/**
 * P3 — derive "failure signal" จาก bms_audit_log (action='ai.tool_call') + bms_conversation_notes
 * (note author='AI' ที่ turn-budget enforcer เขียนตอน force handoff — ดู lib/bms/pipeline.ts)
 * แทนการสร้างตาราง ai_failure_log ใหม่ตาม docs/AI Context Strategy for Multi-Tenant Shops.md § Layer 5
 * GraphQL/UI แสดงผลรวม live-window บนหน้า dashboard โดยไม่สร้าง aggregate table ซ้ำ
 */
export async function getAiFailureSummary(tenantId: string, days = 7): Promise<AiFailureSummary> {
  const d = Math.min(Math.max(days, 1), 90);

  const toolRes = await query<{ target: string | null; outcome: string | null; count: string }>(
    `SELECT target, meta->>'outcome' AS outcome, COUNT(*)::text AS count
       FROM bms_audit_log
      WHERE tenant_id = $1
        AND action = 'ai.tool_call'
        AND created_at >= now() - ($2 || ' days')::interval
      GROUP BY target, meta->>'outcome'`,
    [tenantId, d]
  );

  let totalToolCalls = 0;
  let errorCalls = 0;
  const perTool = new Map<string, number>();
  for (const row of toolRes.rows) {
    const count = Number(row.count);
    totalToolCalls += count;
    const outcome = row.outcome ?? "unknown";
    if (outcome === "error" || outcome === "denied") {
      errorCalls += count;
      const tool = row.target ?? "unknown";
      perTool.set(tool, (perTool.get(tool) ?? 0) + count);
    }
  }
  const topFailingTools: AiToolFailureRow[] = Array.from(perTool.entries())
    .map(([tool, count]) => ({ tool, outcome: "error", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const handoffRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM bms_conversation_notes
      WHERE tenant_id = $1
        AND author = 'AI'
        AND created_at >= now() - ($2 || ' days')::interval`,
    [tenantId, d]
  );

  return {
    days: d,
    totalToolCalls,
    errorCalls,
    handoffCount: Number(handoffRes.rows[0]?.count ?? 0),
    topFailingTools,
  };
}

export async function listAiUsageBreakdown(tenantId: string, limit = 12): Promise<AiUsageBreakdownRow[]> {
  const ym = currentYearMonth();
  const res = await query<any>(
    `SELECT feature,
            COUNT(*)::int AS requests,
            COALESCE(SUM(credits_used), 0)::int AS credits_used,
            COALESCE(SUM(estimated_cost), 0)::numeric AS estimated_cost
       FROM bms_ai_usage_events
      WHERE tenant_id = $1
        AND year_month = $2
        AND status IN ('started','completed','failed')
      GROUP BY feature
      ORDER BY credits_used DESC, requests DESC, feature
      LIMIT $3`,
    [tenantId, ym, Math.max(1, Math.min(limit, 100))]
  );
  return res.rows.map((row) => ({
    feature: String(row.feature),
    requests: Number(row.requests),
    creditsUsed: Number(row.credits_used),
    estimatedCost: Number(row.estimated_cost ?? 0),
  }));
}
