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
import { beginTenantTx } from "./tenant";
import { reportBmsFailure } from "./failureAlert";
import { getTenantPlan, type Plan } from "./plans";
import { aiPeriodResetsAt, budgetLimitStatus, creditLimitStatus, type AiLimitStatus } from "./aiLimitStatus";
import { recordAiLimitNoticesInTx } from "./aiLimitNotices";
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
  tenantId: string;
  yearMonth: string;
  resetsAt: string;
  creditStatus: AiLimitStatus;
  sharedBudgetStatus: AiLimitStatus;
  sharedBudgetRequiredUsd: number;
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
  /**
   * โทเคนรวมของเดือนนี้ — **ไม่ใช่หน่วยของโควตา** โควตาหัก 1 credit ต่อ 1 logical request
   * ไม่ว่ารายการนั้นจะกินโทเคนเท่าไร (วัดจากข้อมูลจริง ~20,000 โทเคนต่อ 1 credit)
   * มีไว้ตอบว่า "ใช้ไปเท่าไรจริง" ซึ่งเป็นคำถามที่ตัวเลขโควตาตอบไม่ได้
   * นับเฉพาะแถวที่ finalize สำเร็จ แถวที่ไม่สำเร็จเหลือ NULL และถูกนับใน unpricedProviderCalls
   */
  inputTokens: number;
  outputTokens: number;
  sharedBudgetLimitUsd: number;
  sharedBudgetSpentUsd: number;
  sharedBudgetReservedUsd: number;
  sharedBudgetRemainingUsd: number;
  sharedBudgetUnaccountedCalls: number;
  sharedBudgetBlocked: boolean;
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
  /** ยอดรวมตอบว่า "ใช้ไปเท่าไร" แต่ตอบไม่ได้ว่าฟีเจอร์ไหนกิน — คำถามถัดไปเสมอ */
  inputTokens: number;
  outputTokens: number;
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

const DEFAULT_DEEPSEEK_RATE = {
  // Conservative peak list rates, verified 2026-10-09. Off-peak discounts are
  // not assumed; attribution is a configured rate card, never an invoice.
  inputPerMillionUsd: 0.3,
  outputPerMillionUsd: 1.2,
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
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

type AiTokenRate = { inputPerMillionUsd: number; outputPerMillionUsd: number; cacheCreationMultiplier: number; cacheReadMultiplier: number };

function priceForModel(
  model?: string | null,
  provider?: string | null
): AiTokenRate | null {
  const p = String(provider || "anthropic").toLowerCase();
  const m = String(model || "").toLowerCase();
  if (p === "deepseek") {
    if (m === "deepseek-v4-pro") {
      return {
        inputPerMillionUsd: 1.32,
        outputPerMillionUsd: 3.96,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: 0.044 / 1.32,
      };
    }
    return ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(m)
      ? DEFAULT_DEEPSEEK_RATE : null;
  }
  if (p === "qwen") {
    if (!["qwen-vl-ocr", "qwen-vl-ocr-latest", "qwen-vl-ocr-2025-11-20"].includes(m)) return null;
    const international = (process.env.QWEN_OCR_BASE_URL ?? "").includes("dashscope-intl.aliyuncs.com");
    return {
      ...DEFAULT_QWEN_OCR_RATE,
      inputPerMillionUsd: positiveEnvRate(
        "QWEN_OCR_INPUT_USD_PER_MILLION",
        international ? 0.07 : DEFAULT_QWEN_OCR_RATE.inputPerMillionUsd
      ),
      outputPerMillionUsd: positiveEnvRate(
        "QWEN_OCR_OUTPUT_USD_PER_MILLION",
        international ? 0.16 : DEFAULT_QWEN_OCR_RATE.outputPerMillionUsd
      ),
    };
  }
  // Exact version families only. A future model must not inherit an older
  // model's cheaper price just because its name contains "sonnet" or "pro".
  const family = m.replace(/[_.]/g, "-").replace(/-(?:[0-9]{8}|latest|fake)$/, "");
  const rates: Record<string, [number, number]> = {
    "claude-haiku-4-5": [1, 5], "claude-3-5-haiku": [0.8, 4],
    "claude-3-haiku": [0.25, 1.25],
    "claude-sonnet-5": [2, 10],
    "claude-sonnet-4-6": [3, 15], "claude-sonnet-4-5": [3, 15], "claude-sonnet-4": [3, 15],
    "claude-3-7-sonnet": [3, 15], "claude-3-5-sonnet": [3, 15], "claude-3-sonnet": [3, 15],
    "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25], "claude-opus-4-6": [5, 25], "claude-opus-4-5": [5, 25],
    "claude-opus-4-1": [15, 75], "claude-opus-4": [15, 75], "claude-3-opus": [15, 75],
  };
  const rate = rates[family];
  if (rate) return { inputPerMillionUsd: rate[0], outputPerMillionUsd: rate[1], cacheCreationMultiplier: 1.25, cacheReadMultiplier: 0.1 };
  return null;
}

/** Platform-funded AI only. Applies to every plan, including unlimited credits. */
export const SHARED_AI_MONTHLY_BUDGET_USD = 100;

export class AiUsageAdmissionError extends Error {
  constructor(readonly code: "AI_BUDGET_EXHAUSTED" | "AI_BUDGET_UNPRICED" | "AI_USAGE_UNAVAILABLE") {
    super(code);
    this.name = "AiUsageAdmissionError";
  }
}

/**
 * Reserve the provider's full supported input envelope, not a guessed tokenizer
 * count. This intentionally refuses near the ceiling when the worst-case call
 * cannot fit. Current allowed models fit within 1M input and 1M output tokens.
 * Cache creation may be more expensive than ordinary input. No model/rate = no
 * platform-funded network call. A new model needs a reviewed envelope and rate.
 */
export function aiAttemptReservationUsd(model: string | null, provider: string | null, maxOutputTokens = 1_000_000): number | null {
  const rate = priceForModel(model, provider);
  if (!rate || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 1_000_000) return null;
  const cost = rate.inputPerMillionUsd * Math.max(1, rate.cacheCreationMultiplier, rate.cacheReadMultiplier)
    + maxOutputTokens / 1_000_000 * rate.outputPerMillionUsd;
  return Math.ceil(cost * 1e8) / 1e8;
}

async function lockUsageMonth(client: PoolClient, tenantId: string, yearMonth: string) {
  await client.query(
    `SELECT tenant_id FROM bms_ai_usage_monthly WHERE tenant_id = $1 AND year_month = $2 FOR UPDATE`,
    [tenantId, yearMonth]
  );
}

async function readSharedBudget(client: PoolClient, tenantId: string, yearMonth: string) {
  const result = await client.query<{ spent: string; reserved: string; unaccounted: number }>(
    `SELECT COALESCE(SUM(actual_cost_usd), 0)::numeric AS spent,
            COALESCE(SUM(budget_reserved_usd), 0)::numeric AS reserved,
            COALESCE(SUM(GREATEST(provider_calls, 1)) FILTER (
              WHERE budget_reserved_usd = 0 AND
                ((provider_calls > 0 AND (actual_cost_usd IS NULL OR unpriced_provider_calls > 0))
                 OR error_message = 'provider_attempt_unrecorded')
            ), 0)::int AS unaccounted
       FROM bms_ai_usage_events
      WHERE tenant_id = $1 AND year_month = $2 AND source = 'shared'`,
    [tenantId, yearMonth]
  );
  const denial = (await client.query(
    `SELECT budget_denied_required_usd,budget_denied_model,budget_denied_provider
     FROM bms_ai_usage_monthly WHERE tenant_id=$1 AND year_month=$2`, [tenantId, yearMonth])).rows[0];
  return {
    spent: Number(result.rows[0].spent), reserved: Number(result.rows[0].reserved), unaccounted: Number(result.rows[0].unaccounted),
    required: Number(denial?.budget_denied_required_usd ?? 0),
    unpricedModel: Boolean(denial?.budget_denied_model),
    limit: SHARED_AI_MONTHLY_BUDGET_USD,
  };
}

/** True only when token usage for this provider/model can be attributed to a configured rate. */
export function hasAiCostRate(model?: string | null, provider?: string | null): boolean {
  return priceForModel(model, provider) !== null;
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

async function transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await work(client);
    // Notification trouble must never undo an already reserved/provider-spent
    // dollar. A savepoint permits a later request/poll to retry the notice.
    await client.query('SAVEPOINT ai_notices');
    try {
      const timeout = (await client.query('SHOW statement_timeout')).rows[0].statement_timeout;
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      const month = currentYearMonth();
      const monthly = (await client.query<MonthlyUsageRow>(
        `SELECT * FROM bms_ai_usage_monthly WHERE tenant_id=$1 AND year_month=$2 FOR UPDATE`, [tenantId, month])).rows[0];
      if (monthly) {
        const plan = await getTenantPlan(tenantId, client);
        const budget = await readSharedBudget(client, tenantId, month);
        await recordAiLimitNoticesInTx(client, tenantId, month, {
          CREDITS: creditLimitStatus(planCreditLimit(plan) < 0,
            monthly.credits_granted + monthly.credits_bonus + monthly.credits_adjusted, monthly.credits_consumed),
          BUDGET: budgetLimitStatus(budget),
        });
      }
      await client.query("SELECT set_config('statement_timeout',$1,true)", [timeout]);
      await client.query('RELEASE SAVEPOINT ai_notices');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT ai_notices');
      await client.query('RELEASE SAVEPOINT ai_notices');
      console.error('[BMS] AI limit notice deferred', error instanceof Error ? error.message : 'unknown');
    }
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
  await transaction(tenantId, async (client) => {
    // Every usage writer locks month -> event, including admission and finalize.
    await lockUsageMonth(client, tenantId, yearMonth);
    const stale = await client.query<{
      id: string;
      billable_credits: number;
      provider_calls: number;
      created_at: Date | string;
    }>(
      `SELECT id, billable_credits, provider_calls, created_at
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
    // `provider_calls = 0` มีสองความหมายที่ต้องปฏิบัติต่างกัน:
    //   (ก) request ถูก abort ก่อนถึง provider จริง → ยังไม่มีใครเสียเงิน คืน credit ถูกต้อง
    //   (ข) เรียก provider ไปแล้วแต่ `recordAiProviderAttempt` เขียนไม่ลง → เสียเงินไปแล้ว
    //       **คืน credit คือการแจกโควตาฟรีให้ค่าใช้ที่เกิดขึ้นจริง**
    // แยกได้จาก incident ที่ (ข) ทิ้งไว้เท่านั้น — ตัวแถวเองหน้าตาเหมือนกันเป๊ะทั้งสองกรณี
    // bound ด้วย created_at ของแถวที่เก่าสุดเพื่อให้วิ่งบน idx_bms_failure_incidents_cooldown
    const oldestStaleAt = stale.rows[0]?.created_at ?? null;
    const unrecorded = await client.query<{ event_id: string | null }>(
      `SELECT meta->>'eventId' AS event_id
         FROM bms_failure_incidents
        WHERE tenant_id = $1
          AND code = 'ai.provider_attempt_unrecorded'
          AND created_at >= $2::timestamptz`,
      [tenantId, oldestStaleAt]
    );
    const unrecordedIds = new Set(
      unrecorded.rows.map((row) => row.event_id).filter((id): id is string => Boolean(id))
    );
    const refundableIds = stale.rows
      .filter((row) => Number(row.provider_calls ?? 0) === 0 && !unrecordedIds.has(row.id))
      .map((row) => row.id);
    const refundCredits = stale.rows.reduce(
      (sum, row) =>
        sum + (refundableIds.includes(row.id) ? Number(row.billable_credits ?? 0) : 0),
      0
    );
    // สามสถานะ ไม่ใช่สอง — `refundable` เป็นชุด id ที่คำนวณมาแล้ว ห้ามกลับไปตัดสินด้วย
    // `provider_calls = 0` ตรง ๆ ใน SQL เพราะนั่นคือเงื่อนไขที่รวมกรณี (ข) เข้ามาด้วย
    await client.query(
      `UPDATE bms_ai_usage_events
          SET status = 'failed',
              credits_used = CASE WHEN id = ANY($2::uuid[]) THEN 0 ELSE credits_used END,
              billable_credits = CASE WHEN id = ANY($2::uuid[]) THEN 0 ELSE billable_credits END,
              actual_cost_usd = CASE WHEN id = ANY($2::uuid[]) THEN 0 ELSE actual_cost_usd END,
              error_message = COALESCE(
                error_message,
                CASE
                  WHEN id = ANY($2::uuid[]) THEN 'provider_not_started_timeout'
                  WHEN provider_calls = 0 THEN 'provider_attempt_unrecorded'
                  ELSE 'usage_finalization_timeout'
                END
              ),
              meta = meta || CASE
                WHEN id = ANY($2::uuid[])
                  THEN '{"credit_refund_reason":"stale_provider_reservation"}'::jsonb
                WHEN provider_calls = 0
                  THEN '{"cost_status":"partial_or_unavailable","stale_usage_finalization":true,"credit_kept_reason":"provider_attempt_unrecorded"}'::jsonb
                ELSE '{"cost_status":"partial_or_unavailable","stale_usage_finalization":true}'::jsonb
              END,
              completed_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, refundableIds]
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

  const { row, accounting, budget } = await transaction(tenantId, async (client) => {
    const row = await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    const accounting = await client.query<{
      requests: number;
      billable_credits: number;
      provider_calls: number;
      unpriced_provider_calls: number;
      actual_cost_usd: string | number;
      input_tokens: number;
      output_tokens: number;
    }>(
      `SELECT COUNT(DISTINCT COALESCE(meta->>'usage_group_id', id::text)) FILTER (
                WHERE status IN ('started','completed','failed','fallback')
              )::int AS requests,
              COALESCE(SUM(billable_credits), 0)::int AS billable_credits,
              COALESCE(SUM(provider_calls), 0)::int AS provider_calls,
              COALESCE(SUM(unpriced_provider_calls), 0)::int AS unpriced_provider_calls,
              COALESCE(SUM(actual_cost_usd), 0)::numeric AS actual_cost_usd,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
         FROM bms_ai_usage_events
        WHERE tenant_id = $1
          AND year_month = $2`,
      [tenantId, yearMonth]
    );
    const budget = await readSharedBudget(client, tenantId, yearMonth);
    return { row, accounting: accounting.rows[0], budget };
  });

  const remaining = limit < 0 ? -1 : balanceFromRow(row);
  const budgetStatus = budgetLimitStatus(budget);
  return {
    tenantId, yearMonth, resetsAt: aiPeriodResetsAt(yearMonth),
    creditStatus: creditLimitStatus(limit < 0, row.credits_granted + row.credits_bonus + row.credits_adjusted, row.credits_consumed),
    sharedBudgetStatus: budgetStatus,
    sharedBudgetRequiredUsd: budget.required,
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
    inputTokens: Number(accounting?.input_tokens ?? 0),
    outputTokens: Number(accounting?.output_tokens ?? 0),
    sharedBudgetLimitUsd: SHARED_AI_MONTHLY_BUDGET_USD,
    sharedBudgetSpentUsd: budget.spent,
    sharedBudgetReservedUsd: budget.reserved,
    sharedBudgetRemainingUsd: Math.max(0, SHARED_AI_MONTHLY_BUDGET_USD - budget.spent - budget.reserved),
    sharedBudgetUnaccountedCalls: budget.unaccounted,
    sharedBudgetBlocked: budgetStatus.startsWith('PAUSED_'),
  };
}

export async function recordByokAiUsage(tenantId: string, ctx?: AiUsageContext): Promise<string> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(tenantId, async (client) => {
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
  return transaction(tenantId, async (client) => {
    await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    return insertUsageEvent(client, tenantId, yearMonth, "shared", "started", 0, ctx);
  });
}

export async function recordAiFallback(tenantId: string, reason: "quota_exhausted" | "no_credentials", ctx?: AiUsageContext): Promise<string> {
  const plan = await getTenantPlan(tenantId);
  const yearMonth = currentYearMonth();
  return transaction(tenantId, async (client) => {
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

  return transaction(tenantId, async (client) => {
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
    /** False when any metered provider response used a model absent from the rate card. */
    costRateKnown?: boolean;
    /** Bounded operational metadata only; never prompts, tool args, or customer data. */
    meta?: Record<string, string | number | boolean | null>;
    /** Per-attempt health result when one logical event crossed providers. */
    providerOutcomes?: Array<{
      provider: string;
      status: "completed" | "failed";
      errorMessage?: string | null;
    }>;
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
    provider_calls: number;
  };
  // Finalization is intentionally one-shot. Callers can encounter overlapping
  // success/error cleanup paths, but an event must contribute to the monthly
  // cost or refund a provider-free reservation only once.
  let current: FinalizedEvent | null;
  try {
    const owner = await query<FinalizedEvent>(
      `SELECT tenant_id, year_month FROM bms_ai_usage_events WHERE id = $1`, [eventId]
    );
    if (!owner.rows[0]) return;
    current = await transaction<FinalizedEvent | null>(owner.rows[0].tenant_id, async (client) => {
    await lockUsageMonth(client, owner.rows[0].tenant_id, owner.rows[0].year_month);
    const event = await client.query<FinalizedEvent & {
      billable_credits: number;
      completed_at: Date | string | null;
      provider_calls: number;
      budget_reserved_usd: string;
    }>(
      `SELECT tenant_id, year_month, model, provider, source, feature,
              billable_credits, completed_at, provider_calls, budget_reserved_usd
         FROM bms_ai_usage_events
        WHERE id = $1
        FOR UPDATE`,
      [eventId]
    );
    const row = event.rows[0];
    if (!row || row.completed_at) return null;

    // Admission persists every attempt before I/O. A failed admission made no
    // provider call; late/incorrect cleanup must never erase a persisted attempt.
    const providerCalls = Math.max(Number(row.provider_calls), result.providerCalls == null
      ? Number(row.provider_calls)
      : Number.isFinite(result.providerCalls) ? Math.min(2_147_483_647, Math.max(0, Math.floor(result.providerCalls))) : Number(row.provider_calls));
    const rawUnpricedProviderCalls = Number(result.unpricedProviderCalls ??
      (providerCalls === 0 || hasCompleteUsage ? 0 : providerCalls));
    const reportedUnpricedProviderCalls = Number.isFinite(rawUnpricedProviderCalls)
      ? Math.min(providerCalls, Math.max(0, Math.floor(rawUnpricedProviderCalls)))
      : providerCalls;

    const rateKnown =
      providerCalls === 0 ||
      (result.costRateKnown ?? priceForModel(row.model, row.provider) !== null);
    const unpricedProviderCalls = rateKnown || (hasValidExplicitCost && explicitEstimatedCost > 0)
      ? Math.min(providerCalls, Math.max(rateKnown ? 0 : 1, result.unpricedProviderCalls == null
          ? (providerCalls === 0 || hasCompleteUsage ? 0 : providerCalls)
          : reportedUnpricedProviderCalls))
      : providerCalls;
    const rawEstimatedCost = Number(
      (hasValidExplicitCost ? explicitEstimatedCost : null) ??
        estimateCachedAiCostUsd({
          inputTokens: Math.max(0, (inputTokens ?? 0) - (cacheReadInputTokens ?? 0) - (cacheCreationInputTokens ?? 0)),
          cacheReadInputTokens, cacheCreationInputTokens, outputTokens,
        }, row.model, row.provider)
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
        : hasAnyMeteredUsage && (rateKnown || (hasValidExplicitCost && explicitEstimatedCost > 0))
          ? estimatedCost
          : null;
    const refundCredits = providerCalls === 0 ? Number(row.billable_credits ?? 0) : 0;
    const finalMeta = JSON.stringify({
      provider_calls: providerCalls,
      credit_policy: "logical_request",
      cost_basis: "provider_usage_rate_card",
      rate_card_version: "2026-10-09",
      ...(row.provider === "deepseek" || result.providerOutcomes?.some(o => o.provider === "deepseek")
        ? { deepseek_pricing: "conservative_peak_list_rate" } : {}),
      cost_status:
        unpricedProviderCalls === 0 ? "measured" : "partial_or_unavailable",
      rate_status: rateKnown ? "known" : "unknown_model",
      unpriced_provider_calls: unpricedProviderCalls,
      ...cacheUsageMeta,
      ...(result.meta ?? {}),
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
              budget_reserved_usd = CASE WHEN $8 = 0 OR $10 = 0 THEN 0
                ELSE GREATEST(budget_reserved_usd - COALESCE($9::numeric, 0), 0) END,
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
      // ⚠️ `$3::numeric` ไม่ใช่การตกแต่ง — ปล่อย `COALESCE($3, 0)` เปล่า ๆ Postgres จะ infer ชนิดของ
      // พารามิเตอร์จาก literal `0` ที่ไม่ระบุชนิด = **integer** แล้ว actualCostUsd
      // ที่เป็นทศนิยม (เช่น 0.00014537) จะ throw `invalid input syntax for type integer`
      // ทำให้ทรานแซกชัน rollback ทั้งก้อน → token/cost ไม่เคยลงเลย แล้วแถวค้าง 'started'
      // จนตัวกวาด stale มาปิดเป็น 'failed' (เห็นบน BMS-LIVE แล้วจริง ก่อนแก้สำเร็จ 0%)
      // คำสั่งที่เขียน event ห่างข้างบนใช้ `COALESCE($5, estimated_cost)` อีกฝั่งเป็น numeric จึง infer ถูกมาตลอด
      `UPDATE bms_ai_usage_monthly
          SET estimated_cost = estimated_cost + COALESCE($3::numeric, 0),
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
      return { ...row, provider_calls: providerCalls };
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
          meta: { eventId, status: result.status, providerCalls: result.providerCalls ?? null },
        });
      }
    } catch (reportErr) {
      console.error("[BMS] failed to report AI usage finalize failure:", reportErr);
    }
    return;
  }

  if (!current) return;

  // AI Provider Health: เฉพาะ shared key ของแพลตฟอร์ม (ไม่ track BYOK ของแต่ละร้าน)
  // Runtime ที่ข้าม provider ส่งผลต่อ attempt มาแยกกัน เพื่อไม่ให้ Anthropic ที่กู้ request สำเร็จ
  // กลบ DeepSeek timeout เป็น success ผิดตัว ส่วน caller เก่าที่ยังไม่ส่ง outcomes จะใช้สถานะรวม
  // completed/failed เหมือนเดิม และข้าม fallback เชิงธุรกิจที่ไม่ใช่สัญญาณว่า provider ล่ม
  if (current.provider_calls > 0 && current.source === "shared") {
    const purpose = aiProviderPurposeFromFeature(current.feature);
    const outcomes = result.providerOutcomes?.length
      ? result.providerOutcomes
      : isTrackedAiProvider(current.provider) &&
          (result.status === "completed" || result.status === "failed")
        ? [{ provider: current.provider, status: result.status, errorMessage: result.errorMessage }]
        : [];
    for (const outcome of outcomes) {
      if (!isTrackedAiProvider(outcome.provider)) continue;
      try {
        if (outcome.status === "completed") {
          await recordProviderSuccess(outcome.provider, purpose);
        } else {
          await recordProviderError(outcome.provider, purpose, outcome.errorMessage);
        }
      } catch (err) {
        console.error("[BMS] failed to update AI provider health:", err);
      }
    }
  }
}

/**
 * Persist an attempt before network I/O so a process crash cannot erase the
 * fact that a provider request was started. Finalization replaces these
 * provisional counters with the exact totals and pricing result.
 */
export async function recordAiProviderAttempt(
  eventId: string,
  attempt?: { provider: string; model: string; maxOutputTokens: number }
): Promise<void> {
  try {
    const owner = await query<{ tenant_id: string; year_month: string }>(
      `SELECT tenant_id, year_month FROM bms_ai_usage_events WHERE id = $1`, [eventId]
    );
    if (!owner.rows[0]) throw new AiUsageAdmissionError("AI_USAGE_UNAVAILABLE");
    const { tenant_id: tenantId, year_month: yearMonth } = owner.rows[0];
    const denied = await transaction(tenantId, async (client) => {
      await lockUsageMonth(client, tenantId, yearMonth);
      const event = await client.query<{
        source: string; provider: string; model: string; completed_at: Date | null;
      }>(`SELECT source, provider, model, completed_at FROM bms_ai_usage_events WHERE id = $1 FOR UPDATE`, [eventId]);
      const row = event.rows[0];
      if (!row || row.completed_at || yearMonth !== currentYearMonth()) {
        throw new AiUsageAdmissionError("AI_USAGE_UNAVAILABLE");
      }
      let reserve = 0;
      if (row.source === "shared") {
        const ceiling = aiAttemptReservationUsd(attempt?.model ?? row.model, attempt?.provider ?? row.provider, attempt?.maxOutputTokens);
        const budget = await readSharedBudget(client, tenantId, yearMonth);
        // Legacy unknown spending is not $0. Require evidence/reconciliation
        // rather than granting another $100 on top of an unknown bill.
        const code = ceiling == null || budget.unaccounted > 0 ? 'AI_BUDGET_UNPRICED'
          : Math.round(budget.spent * 1e8) + Math.round(budget.reserved * 1e8) + Math.round(ceiling * 1e8)
            > SHARED_AI_MONTHLY_BUDGET_USD * 1e8 ? 'AI_BUDGET_EXHAUSTED' : null;
        if (code) {
          await client.query(
            `UPDATE bms_ai_usage_monthly SET
               budget_denied_required_usd=GREATEST(budget_denied_required_usd,$3),
               budget_denied_model=$4,budget_denied_provider=$5
             WHERE tenant_id=$1 AND year_month=$2`,
            [tenantId, yearMonth, ceiling ?? 0, ceiling == null ? (attempt?.model ?? row.model) || 'unknown-model' : null, attempt?.provider ?? row.provider]);
          return code;
        }
        reserve = ceiling!;
        await client.query(
          `UPDATE bms_ai_usage_monthly SET budget_denied_model=NULL,budget_denied_provider=NULL
           WHERE tenant_id=$1 AND year_month=$2`, [tenantId, yearMonth]);
      }
      await client.query(
        `UPDATE bms_ai_usage_events
            SET provider_calls = provider_calls + 1,
                unpriced_provider_calls = unpriced_provider_calls + 1,
                budget_reserved_usd = budget_reserved_usd + $2,
                meta = meta || $3::jsonb
          WHERE id = $1`,
        [eventId, reserve, JSON.stringify({ budget_policy: "shared_usd_100_v2", budget_last_provider: attempt?.provider ?? row.provider })]
      );
      return null;
    });
    // Throw only after committing the refusal evidence and owner notification.
    if (denied) throw new AiUsageAdmissionError(denied);
  } catch (err) {
    // Pre-I/O admission must fail closed. Post-I/O finalization still preserves
    // a valid answer on DB failure and leaves its durable cost reservation held.
    if (err instanceof AiUsageAdmissionError) throw err;
    console.error("[BMS] AI provider admission failed:", err);
    throw new AiUsageAdmissionError("AI_USAGE_UNAVAILABLE");
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
  return transaction(tenantId, async (client) => {
    const row = await ensureMonthlySummary(client, tenantId, yearMonth, plan);
    const nextAdjusted = (row.credits_adjusted ?? 0) + amount;
    const nextBalance = balanceFromRow({ ...row, credits_adjusted: nextAdjusted });
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
            COALESCE(SUM(actual_cost_usd), 0)::numeric AS actual_cost_usd,
            COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
            COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
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
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
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
