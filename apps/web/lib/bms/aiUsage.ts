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
import { reportBmsFailure } from "./failureAlert";
import { getTenantPlan, type Plan } from "./plans";
import {
  recordProviderError,
  recordProviderSuccess,
  type AiProviderName,
  type AiProviderPurpose,
} from "./aiProviderHealth";

function isTrackedAiProvider(provider: string | null): provider is AiProviderName {
  return provider === "anthropic" || provider === "deepseek" || provider === "qwen";
}

/** ทุก feature ตอนนี้เป็น chat ยกเว้น payment_slip_ocr — เพิ่ม OCR feature ใหม่ต้องแก้ที่นี่ */
function aiProviderPurposeFromFeature(feature: string | null): AiProviderPurpose {
  return feature === "payment_slip_ocr" ? "ocr" : "chat";
}

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
  billableCredits: number;
  providerCalls: number;
  actualCostUsd: number;
  unpricedProviderCalls: number;
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
  billableCredits: number;
  creditsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCalls: number;
  unpricedProviderCalls: number;
  actualCostUsd: number | null;
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
  billableCredits: number;
  creditsUsed: number;
  providerCalls: number;
  unpricedProviderCalls: number;
  actualCostUsd: number;
  estimatedCost: number;
};

export type RecentAiUsageEvent = {
  id: string;
  tenantId: string;
  tenantName: string | null;
  source: "shared" | "byok" | "none";
  surface: "customer" | "staff" | "system";
  feature: string;
  channel: string | null;
  provider: string;
  model: string | null;
  status: "started" | "completed" | "failed" | "blocked" | "fallback";
  billableCredits: number;
  creditsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCalls: number;
  unpricedProviderCalls: number;
  actualCostUsd: number | null;
  estimatedCost: number;
  routingReason: string | null;
  configuredProvider: string | null;
  effectiveProvider: string | null;
  fallbackFrom: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TenantAiUsageEvent = Omit<
  RecentAiUsageEvent,
  "tenantId" | "tenantName"
> & {
  sensitive: boolean;
};

const DEFAULT_ANTHROPIC_RATE = {
  inputPerMillionUsd: 3,
  outputPerMillionUsd: 15,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
};

const DEFAULT_DEEPSEEK_RATE = {
  inputPerMillionUsd: 0.14,
  outputPerMillionUsd: 0.28,
  cacheCreationMultiplier: 1,
  cacheReadMultiplier: 0.02,
};

// qwen-vl-ocr through the US/Frankfurt global endpoint, official list price as of 2026-07-30.
// Env overrides keep the estimate correct if the deployment region or Alibaba pricing changes.
const DEFAULT_QWEN_OCR_RATE = {
  inputPerMillionUsd: 0.043,
  outputPerMillionUsd: 0.072,
  cacheCreationMultiplier: 1,
  cacheReadMultiplier: 1,
};

function positiveEnvRate(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

type AiTokenRate = typeof DEFAULT_ANTHROPIC_RATE;

function priceForModel(
  model?: string | null,
  provider?: string | null
): AiTokenRate | null {
  const p = String(provider || "anthropic").toLowerCase();
  const m = String(model || "").toLowerCase();
  if (p === "deepseek") {
    if (m.includes("pro")) {
      return {
        inputPerMillionUsd: 0.435,
        outputPerMillionUsd: 0.87,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: Number((0.003625 / 0.435).toFixed(6)),
      };
    }
    return m.includes("v4-flash") ? DEFAULT_DEEPSEEK_RATE : null;
  }
  if (p === "qwen") {
    if (!m.includes("qwen-vl-ocr")) return null;
    return {
      ...DEFAULT_QWEN_OCR_RATE,
      inputPerMillionUsd: positiveEnvRate(
        "QWEN_OCR_INPUT_USD_PER_MILLION",
        DEFAULT_QWEN_OCR_RATE.inputPerMillionUsd
      ),
      outputPerMillionUsd: positiveEnvRate(
        "QWEN_OCR_OUTPUT_USD_PER_MILLION",
        DEFAULT_QWEN_OCR_RATE.outputPerMillionUsd
      ),
    };
  }
  if (m.includes("haiku") && /4[-_.]?5/.test(m)) {
    return { inputPerMillionUsd: 1, outputPerMillionUsd: 5, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 };
  }
  if (m.includes("haiku") && /3[-_.]?5/.test(m)) {
    return { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 };
  }
  if (m.includes("claude-3-haiku") || m.includes("haiku-3")) {
    return { inputPerMillionUsd: 0.25, outputPerMillionUsd: 1.25, cacheCreationMultiplier: 1.2, cacheReadMultiplier: 0.12 };
  }
  if (/sonnet[-_.]?5(?:[-_.]|$)/.test(m)) {
    const promotionalRateEndsAt = Date.UTC(2026, 8, 1);
    return Date.now() < promotionalRateEndsAt
      ? { inputPerMillionUsd: 2, outputPerMillionUsd: 10, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 }
      : DEFAULT_ANTHROPIC_RATE;
  }
  if (m.includes("sonnet")) return DEFAULT_ANTHROPIC_RATE;
  if (m.includes("opus") && /4[-_.]?(?:5|6|7|8)/.test(m)) {
    return { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 };
  }
  if (m.includes("opus") && /(?:claude-)?(?:opus[-_.]?)?4(?:[-_.]?1)?(?:[-_.]|$)/.test(m)) {
    return { inputPerMillionUsd: 15, outputPerMillionUsd: 75, cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 };
  }
  return null;
}

export function estimateAiCostUsd(
  inputTokens?: number | null,
  outputTokens?: number | null,
  model?: string | null,
  provider?: string | null
) {
  const inTok = Math.max(0, Number(inputTokens ?? 0));
  const outTok = Math.max(0, Number(outputTokens ?? 0));
  const price = priceForModel(model, provider);
  if (!price) return 0;
  const inputCost = (inTok / 1_000_000) * price.inputPerMillionUsd;
  const outputCost = (outTok / 1_000_000) * price.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(8));
}

export function estimateCachedAiCostUsd(
  usage: {
    inputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    outputTokens?: number | null;
  },
  model?: string | null,
  provider?: string | null
) {
  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const cacheCreationInputTokens = Math.max(
    0,
    Number(usage.cacheCreationInputTokens ?? 0)
  );
  const cacheReadInputTokens = Math.max(0, Number(usage.cacheReadInputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  const price = priceForModel(model, provider);
  if (!price) return 0;
  const inputCost =
    ((inputTokens +
      cacheCreationInputTokens * price.cacheCreationMultiplier +
      cacheReadInputTokens * price.cacheReadMultiplier) /
      1_000_000) *
    price.inputPerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * price.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(8));
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

  const res = await client.query<MonthlyUsageRow>(
    `SELECT count, shared_requests, byok_requests, blocked_requests,
            credits_granted, credits_consumed, credits_bonus, credits_adjusted, estimated_cost
       FROM bms_ai_usage_monthly
      WHERE tenant_id = $1 AND year_month = $2
      FOR UPDATE`,
    [tenantId, yearMonth]
  );
  let row = res.rows[0];

  if (row.credits_granted !== grant) {
    const existingGrant = await client.query(
      `SELECT 1
         FROM bms_ai_credit_ledger
        WHERE tenant_id = $1
          AND year_month = $2
          AND entry_type = 'grant'
          AND reference_type = 'monthly_quota'
        LIMIT 1`,
      [tenantId, yearMonth]
    );
    const grantDelta = grant - row.credits_granted;
    row = { ...row, credits_granted: grant };
    await client.query(
      `UPDATE bms_ai_usage_monthly
          SET credits_granted = $3,
              updated_at = now(),
              last_event_at = now()
        WHERE tenant_id = $1 AND year_month = $2`,
      [tenantId, yearMonth, grant]
    );
    if ((existingGrant.rowCount ?? 0) > 0) {
      await client.query(
        `INSERT INTO bms_ai_credit_ledger (
            tenant_id, year_month, entry_type, amount, balance_after,
            reference_type, reference_id, note
          )
          VALUES ($1, $2, 'adjustment', $3, $4, 'plan_grant_change', $5, $6)`,
        [
          tenantId,
          yearMonth,
          grantDelta,
          balanceFromRow(row),
          crypto.randomUUID(),
          `AI plan grant reconciled to ${plan.code}`,
        ]
      );
    }
  }

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
    meta: {
      usage_accounting_version: 2,
      credit_policy: "logical_request",
      provider_calls: 0,
      ...(ctx?.meta ?? {}),
    },
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
        provider, model, status, credits_used, billable_credits,
        provider_calls, unpriced_provider_calls, actual_cost_usd, error_message, meta
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 0, 0,
        CASE WHEN $10 IN ('blocked', 'fallback') OR $4 = 'none' THEN 0 ELSE NULL END,
        $12, $13::jsonb
      )`,
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

const STALE_AI_RESERVATION_MINUTES = 15;

/**
 * Release quota held by a process that died after reserving a logical request
 * but before it persisted any provider attempt. Request counters remain as an
 * operational trace; only the customer-facing credit is returned.
 */
async function reconcileStaleAiReservations(
  tenantId: string,
  yearMonth: string
): Promise<void> {
  await transaction(async (client) => {
    const stale = await client.query<{
      id: string;
      billable_credits: number;
      provider_calls: number;
    }>(
      `SELECT id, billable_credits, provider_calls
         FROM bms_ai_usage_events
        WHERE tenant_id = $1
          AND year_month = $2
          AND status = 'started'
          AND completed_at IS NULL
          AND created_at < now() - ($3::double precision * interval '1 minute')
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED`,
      [tenantId, yearMonth, STALE_AI_RESERVATION_MINUTES]
    );
    if (stale.rows.length === 0) return;

    const ids = stale.rows.map((row) => row.id);
    const refundCredits = stale.rows.reduce(
      (sum, row) =>
        sum + (Number(row.provider_calls ?? 0) === 0 ? Number(row.billable_credits ?? 0) : 0),
      0
    );
    await client.query(
      `UPDATE bms_ai_usage_events
          SET status = 'failed',
              credits_used = CASE WHEN provider_calls = 0 THEN 0 ELSE credits_used END,
              billable_credits = CASE WHEN provider_calls = 0 THEN 0 ELSE billable_credits END,
              actual_cost_usd = CASE WHEN provider_calls = 0 THEN 0 ELSE actual_cost_usd END,
              error_message = COALESCE(
                error_message,
                CASE WHEN provider_calls = 0
                  THEN 'provider_not_started_timeout'
                  ELSE 'usage_finalization_timeout'
                END
              ),
              meta = meta || CASE WHEN provider_calls = 0
                THEN '{"credit_refund_reason":"stale_provider_reservation"}'::jsonb
                ELSE '{"cost_status":"partial_or_unavailable","stale_usage_finalization":true}'::jsonb
              END,
              completed_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const summary = await client.query<MonthlyUsageRow>(
      `UPDATE bms_ai_usage_monthly
          SET credits_consumed = GREATEST(credits_consumed - $3, 0),
              updated_at = now(),
              last_event_at = now()
        WHERE tenant_id = $1
          AND year_month = $2
        RETURNING count, shared_requests, byok_requests, blocked_requests,
                  credits_granted, credits_consumed, credits_bonus,
                  credits_adjusted, estimated_cost`,
      [tenantId, yearMonth, refundCredits]
    );
    if (refundCredits > 0 && summary.rows[0]) {
      await client.query(
        `INSERT INTO bms_ai_credit_ledger (
            tenant_id, year_month, entry_type, amount, balance_after,
            reference_type, reference_id, note
          )
          VALUES ($1, $2, 'refund', $3, $4, 'stale_reservation_sweep', $5, $6)`,
        [
          tenantId,
          yearMonth,
          refundCredits,
          balanceFromRow(summary.rows[0]),
          crypto.randomUUID(),
          `Returned ${refundCredits} credit(s) from provider-free stale reservation(s)`,
        ]
      );
    }
  });
}

export async function getAiUsage(tenantId: string): Promise<AiUsage> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  const limit = planCreditLimit(plan);
  const grant = creditGrantForPlan(plan);

  await reconcileStaleAiReservations(tenantId, yearMonth);

  const { row, accounting } = await transaction(async (client) => {
    const row = await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    const accounting = await client.query<{
      requests: number;
      billable_credits: number;
      provider_calls: number;
      unpriced_provider_calls: number;
      actual_cost_usd: string | number;
    }>(
      `SELECT COUNT(DISTINCT COALESCE(meta->>'usage_group_id', id::text)) FILTER (
                WHERE status IN ('started','completed','failed','fallback')
              )::int AS requests,
              COALESCE(SUM(billable_credits), 0)::int AS billable_credits,
              COALESCE(SUM(provider_calls), 0)::int AS provider_calls,
              COALESCE(SUM(unpriced_provider_calls), 0)::int AS unpriced_provider_calls,
              COALESCE(SUM(actual_cost_usd), 0)::numeric AS actual_cost_usd
         FROM bms_ai_usage_events
        WHERE tenant_id = $1
          AND year_month = $2`,
      [tenantId, yearMonth]
    );
    return { row, accounting: accounting.rows[0] };
  });

  const remaining = limit < 0 ? -1 : balanceFromRow(row);
  return {
    count: row.credits_consumed ?? row.count ?? 0,
    limit,
    remaining,
    unlimited: limit < 0,
    planCode: plan.code,
    planName: plan.name,
    requestCount: Number(accounting?.requests ?? 0),
    sharedRequests: row.shared_requests ?? 0,
    byokRequests: row.byok_requests ?? 0,
    blockedRequests: row.blocked_requests ?? 0,
    grantedCredits: row.credits_granted ?? grant,
    bonusCredits: row.credits_bonus ?? 0,
    adjustedCredits: row.credits_adjusted ?? 0,
    billableCredits: Number(accounting?.billable_credits ?? 0),
    providerCalls: Number(accounting?.provider_calls ?? 0),
    actualCostUsd: Number(accounting?.actual_cost_usd ?? 0),
    unpricedProviderCalls: Number(accounting?.unpriced_provider_calls ?? 0),
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

/** Create a trace/cost event for a provider retry without billing a second logical-request credit. */
export async function recordSharedAiRetryUsage(
  tenantId: string,
  ctx?: AiUsageContext
): Promise<string> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    return insertUsageEvent(client, tenantId, yearMonth, "shared", "started", 0, ctx);
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

  await reconcileStaleAiReservations(tenantId, yearMonth);

  return transaction(async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);

    if (!unlimited) {
      const upd = await client.query<MonthlyUsageRow>(
        `UPDATE bms_ai_usage_monthly
            SET count = count + 1,
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
          SET count = count + 1,
              shared_requests = shared_requests + 1,
              last_event_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND year_month = $2
        RETURNING count, shared_requests, byok_requests, blocked_requests,
                  credits_granted, credits_consumed, credits_bonus, credits_adjusted, estimated_cost`,
      [tenantId, yearMonth]
    );
    const eventId = await insertUsageEvent(client, tenantId, yearMonth, "shared", "started", 0, ctx);
    await client.query(
      `INSERT INTO bms_ai_credit_ledger (
          tenant_id, year_month, entry_type, amount, balance_after,
          reference_type, reference_id, note
        )
        VALUES ($1, $2, 'consume', 0, 0, 'ai_usage_event', $3, $4)`,
      [tenantId, yearMonth, eventId, `${normalizeCtx(ctx).feature} (unlimited plan)`]
    );
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
    /** Number of provider HTTP attempts represented by this logical event. */
    providerCalls?: number;
    /** Provider attempts that returned no usage payload and cannot be priced. */
    unpricedProviderCalls?: number;
    /** Overrides token-presence inference when usage is only partially available. */
    costMeasured?: boolean;
  }
): Promise<void> {
  const tokenCount = (value: number | null | undefined): number | null => {
    if (value == null || !Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.floor(value), 2_147_483_647);
  };
  const inputTokens = tokenCount(result.inputTokens);
  const outputTokens = tokenCount(result.outputTokens);
  const cacheReadInputTokens = tokenCount(result.cacheReadInputTokens);
  const cacheCreationInputTokens = tokenCount(result.cacheCreationInputTokens);
  // เขียน meta เฉพาะตอน caller รู้ค่าจริง (path ที่ไม่ได้ตั้ง cache_control จะไม่มี key เหล่านี้เลย
  // ซึ่งต่างจากการมี key แล้วเป็น 0 — 0 หมายถึง "ตั้ง cache_control แล้วแต่ไม่ hit")
  const rawProviderCalls = Number(result.providerCalls ?? 1);
  const providerCalls = Number.isFinite(rawProviderCalls)
    ? Math.min(2_147_483_647, Math.max(0, Math.floor(rawProviderCalls)))
    : 0;
  const explicitEstimatedCost = Number(result.estimatedCost);
  const hasValidExplicitCost =
    result.estimatedCost != null &&
    Number.isFinite(explicitEstimatedCost) &&
    explicitEstimatedCost >= 0;
  const hasAnyMeteredUsage = result.costMeasured ?? (
    hasValidExplicitCost ||
    inputTokens !== null ||
    outputTokens !== null
  );
  const hasCompleteUsage =
    hasValidExplicitCost ||
    (inputTokens !== null && outputTokens !== null);
  const rawUnpricedProviderCalls = Number(
    result.unpricedProviderCalls ??
      (providerCalls === 0 || hasCompleteUsage ? 0 : providerCalls)
  );
  const reportedUnpricedProviderCalls = Number.isFinite(rawUnpricedProviderCalls)
    ? Math.min(
        providerCalls,
        Math.max(0, Math.floor(rawUnpricedProviderCalls))
      )
    : providerCalls;
  const cacheUsageMeta =
    cacheReadInputTokens === null && cacheCreationInputTokens === null
      ? {}
      : {
          cache_read_input_tokens: cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: cacheCreationInputTokens ?? 0,
          regular_input_tokens: Math.max(
            0,
            (inputTokens ?? 0) -
              (cacheReadInputTokens ?? 0) -
              (cacheCreationInputTokens ?? 0)
          ),
        };
  type FinalizedEvent = {
    tenant_id: string;
    year_month: string;
    model: string | null;
    provider: string | null;
    source: string | null;
    feature: string | null;
  };
  // Finalization is intentionally one-shot. Callers can encounter overlapping
  // success/error cleanup paths, but an event must contribute to the monthly
  // cost or refund a provider-free reservation only once.
  let current: FinalizedEvent | null;
  try {
    current = await transaction<FinalizedEvent | null>(async (client) => {
    const event = await client.query<FinalizedEvent & {
      billable_credits: number;
      completed_at: Date | string | null;
    }>(
      `SELECT tenant_id, year_month, model, provider, source, feature,
              billable_credits, completed_at
         FROM bms_ai_usage_events
        WHERE id = $1
        FOR UPDATE`,
      [eventId]
    );
    const row = event.rows[0];
    if (!row || row.completed_at) return null;

    const rateKnown = providerCalls === 0 || priceForModel(row.model, row.provider) !== null;
    const unpricedProviderCalls = rateKnown
      ? reportedUnpricedProviderCalls
      : providerCalls;
    const rawEstimatedCost = Number(
      (hasValidExplicitCost ? explicitEstimatedCost : null) ??
        estimateAiCostUsd(inputTokens, outputTokens, row.model, row.provider)
    );
    const estimatedCost =
      Number.isFinite(rawEstimatedCost) && rawEstimatedCost >= 0
        ? Number(rawEstimatedCost.toFixed(8))
        : 0;
    // Keep the cost we can prove even when another attempt in the same logical
    // request returned no usage payload. The unknown portion remains explicit.
    const actualCostUsd =
      providerCalls === 0
        ? 0
        : rateKnown && hasAnyMeteredUsage
          ? estimatedCost
          : null;
    const refundCredits = providerCalls === 0 ? Number(row.billable_credits ?? 0) : 0;
    const finalMeta = JSON.stringify({
      provider_calls: providerCalls,
      credit_policy: "logical_request",
      cost_basis: "provider_usage_rate_card",
      cost_status:
        unpricedProviderCalls === 0 ? "measured" : "partial_or_unavailable",
      rate_status: rateKnown ? "known" : "unknown_model",
      unpriced_provider_calls: unpricedProviderCalls,
      ...cacheUsageMeta,
      ...(refundCredits > 0 ? { credit_refund_reason: "provider_not_called" } : {}),
    });

    await client.query(
      `UPDATE bms_ai_usage_events
          SET status = $2,
              input_tokens = COALESCE($3, input_tokens),
              output_tokens = COALESCE($4, output_tokens),
              estimated_cost = COALESCE($5, estimated_cost),
              provider_calls = $8,
              unpriced_provider_calls = $10,
              actual_cost_usd = $9,
              billable_credits = GREATEST(billable_credits - $11, 0),
              credits_used = GREATEST(credits_used - $11, 0),
              error_message = COALESCE($6, error_message),
              meta = meta || COALESCE($7::jsonb, '{}'::jsonb),
              completed_at = now()
        WHERE id = $1`,
      [
        eventId,
        result.status,
        inputTokens,
        outputTokens,
        estimatedCost,
        result.errorMessage ?? null,
        finalMeta,
        providerCalls,
        actualCostUsd,
        unpricedProviderCalls,
        refundCredits,
      ]
    );
    const summary = await client.query<MonthlyUsageRow>(
      `UPDATE bms_ai_usage_monthly
          SET estimated_cost = estimated_cost + COALESCE($3, 0),
              credits_consumed = GREATEST(credits_consumed - $4, 0),
              updated_at = now(),
              last_event_at = now()
        WHERE tenant_id = $1
          AND year_month = $2
        RETURNING count, shared_requests, byok_requests, blocked_requests,
                  credits_granted, credits_consumed, credits_bonus,
                  credits_adjusted, estimated_cost`,
      [row.tenant_id, row.year_month, actualCostUsd, refundCredits]
    );
    if (refundCredits > 0 && summary.rows[0]) {
      await client.query(
        `INSERT INTO bms_ai_credit_ledger (
            tenant_id, year_month, entry_type, amount, balance_after,
            reference_type, reference_id, note
          )
          VALUES ($1, $2, 'refund', $3, $4, 'ai_usage_event', $5, 'Provider was not called')
          ON CONFLICT (tenant_id, year_month, entry_type, reference_type, reference_id)
          DO NOTHING`,
        [
          row.tenant_id,
          row.year_month,
          refundCredits,
          balanceFromRow(summary.rows[0]),
          eventId,
        ]
      );
    }
      return row;
    });
  } catch (err) {
    // Accounting is observability after the provider call. Keep the provisional
    // unpriced attempt visible and never discard a valid user response because
    // the accounting database had a transient failure. **Still must not throw.**
    console.error("[BMS] failed to finalize AI usage event:", err);
    // ...but it must not be invisible either. Swallowing this silently is how
    // every usage row in BMS-LIVE ended up stuck at 'started' with NULL tokens
    // while dashboards looked fine (found 2026-08-19 while diagnosing an
    // unrelated customer-facing bug — the missing token data cost a whole
    // round of investigation). Reporting is best-effort on purpose: if the
    // database itself is down, the report cannot land either, and this path
    // must never turn an accounting problem into a failed customer reply.
    try {
      const owner = await query<{ tenant_id: string }>(
        `SELECT tenant_id FROM bms_ai_usage_events WHERE id = $1`,
        [eventId]
      );
      const tenantId = owner.rows[0]?.tenant_id;
      if (tenantId) {
        await reportBmsFailure({
          tenantId,
          code: "ai.usage_finalize_failed",
          error: err,
          surface: "system",
          meta: { eventId, status: result.status, providerCalls },
        });
      }
    } catch (reportErr) {
      console.error("[BMS] failed to report AI usage finalize failure:", reportErr);
    }
    return;
  }

  if (!current) return;

  // AI Provider Health: เฉพาะ shared key ของแพลตฟอร์ม (ไม่ track BYOK ของแต่ละร้าน)
  // และเฉพาะ completed/failed จริง — ข้าม 'fallback' เพราะเหตุผลอื่น (quota_exhausted/
  // no_credentials/max_rounds_exceeded/slip image unavailable) ไม่ใช่สัญญาณว่า provider ล่ม
  if (
    providerCalls > 0 &&
    current.source === "shared" &&
    isTrackedAiProvider(current.provider)
  ) {
    const purpose = aiProviderPurposeFromFeature(current.feature);
    try {
      if (result.status === "completed") {
        await recordProviderSuccess(current.provider, purpose);
      } else if (result.status === "failed") {
        await recordProviderError(current.provider, purpose, result.errorMessage);
      }
    } catch (err) {
      console.error("[BMS] failed to update AI provider health:", err);
    }
  }
}

/**
 * Persist an attempt before network I/O so a process crash cannot erase the
 * fact that a provider request was started. Finalization replaces these
 * provisional counters with the exact totals and pricing result.
 */
export async function recordAiProviderAttempt(eventId: string): Promise<void> {
  try {
    await query(
      `UPDATE bms_ai_usage_events
          SET provider_calls = provider_calls + 1,
              unpriced_provider_calls = unpriced_provider_calls + 1
        WHERE id = $1
          AND completed_at IS NULL`,
      [eventId]
    );
  } catch (err) {
    console.error("[BMS] failed to persist AI provider attempt:", err);
  }
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
            COUNT(DISTINCT COALESCE(meta->>'usage_group_id', id::text))::int AS requests,
            COALESCE(SUM(billable_credits), 0)::int AS billable_credits,
            COALESCE(SUM(provider_calls), 0)::int AS provider_calls,
            COALESCE(SUM(unpriced_provider_calls), 0)::int AS unpriced_provider_calls,
            COALESCE(SUM(actual_cost_usd), 0)::numeric AS actual_cost_usd
       FROM bms_ai_usage_events
      WHERE tenant_id = $1
        AND year_month = $2
        AND status IN ('started','completed','failed','fallback')
      GROUP BY feature
      ORDER BY billable_credits DESC, requests DESC, feature
      LIMIT $3`,
    [tenantId, ym, Math.max(1, Math.min(limit, 100))]
  );
  return res.rows.map((row) => ({
    feature: String(row.feature),
    requests: Number(row.requests),
    billableCredits: Number(row.billable_credits),
    creditsUsed: Number(row.billable_credits),
    providerCalls: Number(row.provider_calls),
    unpricedProviderCalls: Number(row.unpriced_provider_calls),
    actualCostUsd: Number(row.actual_cost_usd ?? 0),
    estimatedCost: Number(row.actual_cost_usd ?? 0),
  }));
}

/**
 * Tenant-admin diagnostics used by the live AI eval and the settings surface.
 * Only safe, normalized routing fields are exposed — never raw prompts, tool
 * arguments, error messages, or the correlation value itself.
 */
export async function listRecentAiUsageEvents(
  tenantId: string,
  opts: {
    limit?: number;
    evalRef?: string | null;
    feature?: string | null;
  } = {}
): Promise<TenantAiUsageEvent[]> {
  const res = await query<any>(
    `SELECT e.id,
            e.source,
            e.surface,
            e.feature,
            e.channel,
            e.provider,
            e.model,
            e.status,
            e.billable_credits,
            e.credits_used,
            e.input_tokens,
            e.output_tokens,
            e.actual_cost_usd,
            e.estimated_cost,
            e.provider_calls,
            e.unpriced_provider_calls,
            e.meta->>'routing_reason' AS routing_reason,
            e.meta->>'configured_provider' AS configured_provider,
            e.meta->>'effective_provider' AS effective_provider,
            e.meta->>'fallback_from' AS fallback_from,
            CASE
              WHEN lower(COALESCE(e.meta->>'sensitive', 'false')) = 'true'
                THEN true
              ELSE false
            END AS sensitive,
            e.created_at,
            e.completed_at
       FROM bms_ai_usage_events e
      WHERE e.tenant_id = $1
        AND ($2::text IS NULL OR e.meta->>'eval_ref' = $2)
        AND ($3::text IS NULL OR e.feature = $3)
      ORDER BY e.created_at DESC
      LIMIT $4`,
    [
      tenantId,
      opts.evalRef?.trim() || null,
      opts.feature?.trim() || null,
      Math.max(1, Math.min(opts.limit ?? 20, 100)),
    ]
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    source: row.source,
    surface: row.surface,
    feature: String(row.feature),
    channel: row.channel ? String(row.channel) : null,
    provider: String(row.provider),
    model: row.model ? String(row.model) : null,
    status: row.status,
    billableCredits: Number(row.billable_credits ?? 0),
    creditsUsed: Number(row.credits_used ?? 0),
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    providerCalls: Number(row.provider_calls ?? 0),
    unpricedProviderCalls: Number(row.unpriced_provider_calls ?? 0),
    actualCostUsd: row.actual_cost_usd == null ? null : Number(row.actual_cost_usd),
    estimatedCost: Number(row.estimated_cost ?? 0),
    routingReason: row.routing_reason ? String(row.routing_reason) : null,
    configuredProvider: row.configured_provider
      ? String(row.configured_provider)
      : null,
    effectiveProvider: row.effective_provider
      ? String(row.effective_provider)
      : null,
    fallbackFrom: row.fallback_from ? String(row.fallback_from) : null,
    sensitive: Boolean(row.sensitive),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    completedAt:
      row.completed_at == null
        ? null
        : row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at),
  }));
}

/**
 * Platform-admin diagnostics: latest AI usage rows across every tenant.
 * Caller must enforce platform-admin access before exposing this data.
 */
export async function listRecentAiUsageEventsGlobal(
  limit = 12
): Promise<RecentAiUsageEvent[]> {
  const res = await query<any>(
    `SELECT e.id,
            e.tenant_id,
            t.name AS tenant_name,
            e.source,
            e.surface,
            e.feature,
            e.channel,
            e.provider,
            e.model,
            e.status,
            e.billable_credits,
            e.credits_used,
            e.input_tokens,
            e.output_tokens,
            e.actual_cost_usd,
            e.estimated_cost,
            e.provider_calls,
            e.unpriced_provider_calls,
            e.meta->>'routing_reason' AS routing_reason,
            e.meta->>'configured_provider' AS configured_provider,
            e.meta->>'effective_provider' AS effective_provider,
            e.meta->>'fallback_from' AS fallback_from,
            e.created_at,
            e.completed_at
       FROM bms_ai_usage_events e
       LEFT JOIN bms_tenants t ON t.id = e.tenant_id
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(limit, 50))]
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    tenantName: row.tenant_name ? String(row.tenant_name) : null,
    source: row.source,
    surface: row.surface,
    feature: String(row.feature),
    channel: row.channel ? String(row.channel) : null,
    provider: String(row.provider),
    model: row.model ? String(row.model) : null,
    status: row.status,
    billableCredits: Number(row.billable_credits ?? 0),
    creditsUsed: Number(row.credits_used ?? 0),
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    providerCalls: Number(row.provider_calls ?? 0),
    unpricedProviderCalls: Number(row.unpriced_provider_calls ?? 0),
    actualCostUsd: row.actual_cost_usd == null ? null : Number(row.actual_cost_usd),
    estimatedCost: Number(row.estimated_cost ?? 0),
    routingReason: row.routing_reason ? String(row.routing_reason) : null,
    configuredProvider: row.configured_provider
      ? String(row.configured_provider)
      : null,
    effectiveProvider: row.effective_provider
      ? String(row.effective_provider)
      : null,
    fallbackFrom: row.fallback_from ? String(row.fallback_from) : null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    completedAt:
      row.completed_at == null
        ? null
        : row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at),
  }));
}
