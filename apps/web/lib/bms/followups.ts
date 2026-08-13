// =============================================================
// BMS Follow-up Automation — MVP core
// -------------------------------------------------------------
// Conversation entity / intent detection already live in bms_conversations /
// bms_conversation_intents (migration 7.52). This module is the configurable
// Rule Engine + Scheduler + AI follow-up generation — nothing here hardcodes
// a delay/goal/retry count, it only ever reads bms_followup_rules.
//
// Deliberately NOT the full spec (see CLAUDE.local.md § Follow-up Automation):
// no Workflow Engine (multi-step branching trees) and no Follow-up Scoring
// model — this MVP uses rule `priority` + universal stop-conditions instead.
// `bms_followup_rules.stop_conditions` is stored/validated for forward
// compatibility with a future workflow engine, but is NOT read here: the six
// stop rules in the spec ("never follow up if...") are treated as always-on
// safety rails, not something a rule can opt out of — an admin should not be
// able to accidentally re-enable spamming a customer who already replied.
//
// Cron entrypoint is runDueFollowups() (called by
// app/api/bms/followups/run/route.ts) — it scans every tenant itself, same
// shape as detectStaleChannels()/runScheduledDigests().
// =============================================================

import { query } from "@/lib/db";
import { audit } from "./audit";
import { getConversation, listMessages, sendFollowupMessage } from "./inbox";
import { getCustomer360 } from "./customer360";
import { getStoreProfile } from "./storeProfile";
import { resolveAiCredentials, type AiCredentials } from "./ai";
import { finalizeAiUsageEvent, recordAiProviderAttempt } from "./aiUsage";
import { callAnthropicCompatibleMessages } from "./aiProvider";

export const FOLLOWUP_INTENTS = [
  "ASK_PRICE",
  "PRODUCT_INFORMATION",
  "ORDER",
  "BOOKING",
  "SUPPORT",
  "COMPLAINT",
  "PAYMENT",
  "DELIVERY",
  "GENERAL_QUESTION",
  "OTHER",
] as const;
export type FollowupIntent = (typeof FOLLOWUP_INTENTS)[number];

export const MESSAGE_GOALS = [
  "CLOSE_SALE",
  "COLLECT_MISSING_INFO",
  "CONTINUE_CONVERSATION",
  "CONFIRM_BOOKING",
  "CUSTOMER_SATISFACTION",
  "PAYMENT_REMINDER",
  "RECOVER_ABANDONED_CART",
  "SUPPORT_FOLLOWUP",
] as const;
export type MessageGoal = (typeof MESSAGE_GOALS)[number];

// Stored/validated for the future workflow engine — see module header. Not
// interpreted by runDueFollowups() today.
export const STOP_CONDITIONS = [
  "customer_replied",
  "staff_replied",
  "conversation_closed",
  "max_retry_exceeded",
  "opted_out",
  "rule_disabled",
] as const;
export type StopCondition = (typeof STOP_CONDITIONS)[number];

export type FollowupRule = {
  id: string;
  tenantId: string;
  intent: FollowupIntent;
  enabled: boolean;
  priority: number;
  delayMinutes: number;
  maxRetry: number;
  stopConditions: string[];
  messageGoal: MessageGoal;
  businessHoursOnly: boolean;
  template: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FollowupRuleInput = {
  id?: string | null;
  intent: string;
  enabled?: boolean;
  priority?: number;
  delayMinutes: number;
  maxRetry?: number;
  stopConditions?: string[];
  messageGoal: string;
  businessHoursOnly?: boolean;
  template?: string | null;
};

function mapRule(r: any): FollowupRule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    intent: r.intent,
    enabled: r.enabled,
    priority: r.priority,
    delayMinutes: r.delay_minutes,
    maxRetry: r.max_retry,
    stopConditions: r.stop_conditions ?? [],
    messageGoal: r.message_goal,
    businessHoursOnly: r.business_hours_only,
    template: r.template ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function assertIntent(v: string): FollowupIntent {
  if (!(FOLLOWUP_INTENTS as readonly string[]).includes(v)) {
    throw new Error(`intent ต้องเป็นหนึ่งใน: ${FOLLOWUP_INTENTS.join(", ")}`);
  }
  return v as FollowupIntent;
}

function assertGoal(v: string): MessageGoal {
  if (!(MESSAGE_GOALS as readonly string[]).includes(v)) {
    throw new Error(`messageGoal ต้องเป็นหนึ่งใน: ${MESSAGE_GOALS.join(", ")}`);
  }
  return v as MessageGoal;
}

/** ทิ้งค่าที่ไม่รู้จักเงียบๆ (ตาม convention เดียวกับ enabled_carriers filter) */
function sanitizeStopConditions(list: string[] | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((v) => (STOP_CONDITIONS as readonly string[]).includes(v));
}

function systemActor(tenantId: string) {
  return { tenant_id: tenantId, admin: { email: "system:followup-scheduler" } };
}

// =============================================================
// Rule CRUD
// =============================================================

export async function listFollowupRules(tenantId: string): Promise<FollowupRule[]> {
  const res = await query(
    `SELECT * FROM bms_followup_rules WHERE tenant_id = $1 ORDER BY priority DESC, created_at DESC`,
    [tenantId]
  );
  return res.rows.map(mapRule);
}

export async function upsertFollowupRule(tenantId: string, input: FollowupRuleInput): Promise<FollowupRule> {
  const intent = assertIntent(input.intent);
  const messageGoal = assertGoal(input.messageGoal);
  const delayMinutes = Number(input.delayMinutes);
  if (!Number.isInteger(delayMinutes) || delayMinutes <= 0) {
    throw new Error("delayMinutes ต้องเป็นจำนวนเต็มมากกว่า 0");
  }
  const maxRetry = input.maxRetry != null ? Number(input.maxRetry) : 1;
  if (!Number.isInteger(maxRetry) || maxRetry < 0) {
    throw new Error("maxRetry ต้องเป็นจำนวนเต็ม >= 0");
  }
  const stopConditions = sanitizeStopConditions(input.stopConditions);
  const priority = input.priority != null ? Number(input.priority) : 0;
  const enabled = input.enabled ?? true;
  const businessHoursOnly = input.businessHoursOnly ?? false;
  const template = input.template ?? null;

  if (input.id) {
    const res = await query(
      `UPDATE bms_followup_rules
          SET intent = $2, enabled = $3, priority = $4, delay_minutes = $5, max_retry = $6,
              stop_conditions = $7, message_goal = $8, business_hours_only = $9, template = $10,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $11
      RETURNING *`,
      [tenantId, intent, enabled, priority, delayMinutes, maxRetry, stopConditions, messageGoal, businessHoursOnly, template, input.id]
    );
    if (res.rowCount === 0) throw new Error("ไม่พบ follow-up rule");
    return mapRule(res.rows[0]);
  }

  const res = await query(
    `INSERT INTO bms_followup_rules
       (tenant_id, intent, enabled, priority, delay_minutes, max_retry, stop_conditions, message_goal, business_hours_only, template)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [tenantId, intent, enabled, priority, delayMinutes, maxRetry, stopConditions, messageGoal, businessHoursOnly, template]
  );
  return mapRule(res.rows[0]);
}

export async function deleteFollowupRule(tenantId: string, id: string): Promise<boolean> {
  const res = await query(`DELETE FROM bms_followup_rules WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (res.rowCount ?? 0) > 0;
}

/** highest-priority enabled rule for this intent — null = ไม่มี rule ให้ทำอะไรเลย (ไม่ invent) */
export async function matchRule(tenantId: string, intent: string): Promise<FollowupRule | null> {
  const res = await query(
    `SELECT * FROM bms_followup_rules
      WHERE tenant_id = $1 AND intent = $2 AND enabled
      ORDER BY priority DESC, created_at ASC
      LIMIT 1`,
    [tenantId, intent]
  );
  return res.rowCount ? mapRule(res.rows[0]) : null;
}

// =============================================================
// Intent classification — AI-first, deterministic keyword fallback.
// A separate intent set from lib/bms/nlu.ts's Intent (CHECK_STOCK/
// CONFIRM_ORDER/GREETING/UNKNOWN) on purpose: that type is load-bearing for
// the live chat pipeline's deterministic fallback and must not change shape.
// =============================================================

const HEURISTIC_KEYWORDS: Array<[FollowupIntent, string[]]> = [
  ["COMPLAINT", ["ผิดหวัง", "แย่", "ไม่พอใจ", "ร้องเรียน", "complaint", "bad", "disappointed"]],
  ["PAYMENT", ["โอนเงิน", "ชำระ", "จ่ายเงิน", "สลิป", "payment", "pay", "transfer"]],
  ["DELIVERY", ["จัดส่ง", "ส่งของ", "พัสดุ", "ติดตาม", "delivery", "shipping", "tracking"]],
  ["BOOKING", ["จอง", "นัด", "booking", "appointment", "reserve"]],
  ["SUPPORT", ["ช่วยด้วย", "แก้ปัญหา", "support", "help", "issue", "problem"]],
  ["ORDER", ["สั่งซื้อ", "สั่งของ", "order", "buy", "purchase"]],
  ["ASK_PRICE", ["ราคา", "เท่าไหร่", "price", "cost", "how much"]],
  ["PRODUCT_INFORMATION", ["สินค้า", "รายละเอียด", "สเปค", "product", "detail", "spec"]],
  ["GENERAL_QUESTION", ["สอบถาม", "คำถาม", "question", "ask"]],
];

function heuristicIntent(text: string): { intent: FollowupIntent; confidence: number } {
  const lower = text.toLowerCase();
  for (const [intent, keywords] of HEURISTIC_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return { intent, confidence: 0.5 };
    }
  }
  return { intent: "OTHER", confidence: 0.3 };
}

function parseAiIntentJson(text: string): { intent: string; confidence: number } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    if (typeof parsed?.intent === "string" && typeof parsed?.confidence === "number") {
      return { intent: parsed.intent, confidence: parsed.confidence };
    }
  } catch {
    // fall through to heuristic
  }
  return null;
}

export async function classifyConversationIntent(
  tenantId: string,
  conversationId: string
): Promise<{ intent: FollowupIntent; confidence: number; source: "ai" | "heuristic" }> {
  const messages = await listMessages(tenantId, conversationId, 20);
  const transcript = messages
    .map((m: any) => `${m.direction === "IN" ? "customer" : "shop"}: ${(m.body || "").slice(0, 300)}`)
    .join("\n");

  let result: { intent: FollowupIntent; confidence: number; source: "ai" | "heuristic" } | null = null;

  const creds = await resolveAiCredentials(tenantId, { surface: "system", feature: "followup_intent" });
  if (creds) {
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    try {
      if (creds.usageEventId) await recordAiProviderAttempt(creds.usageEventId);
      const resp = await callAnthropicCompatibleMessages(creds as AiCredentials, {
        model: creds.model,
        max_tokens: 100,
        system:
          `Classify the customer conversation's intent. Reply with ONLY a JSON object ` +
          `{"intent": "<ONE_OF>", "confidence": <0..1>} — no other text. ` +
          `<ONE_OF> must be exactly one of: ${FOLLOWUP_INTENTS.join(", ")}.`,
        messages: [{ role: "user", content: transcript || "(no messages)" }],
      });
      if (resp.ok) {
        const json = (await resp.json()) as {
          content?: Array<{ text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        usage = json.usage;
        const raw = json.content?.[0]?.text?.trim();
        const parsed = raw ? parseAiIntentJson(raw) : null;
        if (parsed && (FOLLOWUP_INTENTS as readonly string[]).includes(parsed.intent)) {
          result = {
            intent: parsed.intent as FollowupIntent,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
            source: "ai",
          };
        }
      }
      if (creds.usageEventId) {
        await finalizeAiUsageEvent(creds.usageEventId, {
          status: result ? "completed" : "failed",
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
        });
      }
    } catch (err) {
      if (creds.usageEventId) {
        await finalizeAiUsageEvent(creds.usageEventId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "followup intent classification failed",
        });
      }
      console.error("[BMS] followup intent classification (AI) failed, falling back:", err);
    }
  }

  if (!result) {
    const h = heuristicIntent(transcript);
    result = { ...h, source: "heuristic" };
  }

  await query(
    `INSERT INTO bms_conversation_intents (tenant_id, conversation_id, intent, confidence, source)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, conversationId, result.intent, result.confidence, result.source]
  );
  return result;
}

const INTENT_STALE_MS = 24 * 60 * 60 * 1000; // reclassify if the latest intent row is older than this

async function getOrClassifyIntent(tenantId: string, conversationId: string): Promise<FollowupIntent> {
  const latest = await query<{ intent: string; detected_at: Date | string }>(
    `SELECT intent, detected_at FROM bms_conversation_intents
      WHERE conversation_id = $1 ORDER BY detected_at DESC LIMIT 1`,
    [conversationId]
  );
  const row = latest.rows[0];
  if (row) {
    const age = Date.now() - new Date(row.detected_at).getTime();
    if (age < INTENT_STALE_MS) return row.intent as FollowupIntent;
  }
  const fresh = await classifyConversationIntent(tenantId, conversationId);
  return fresh.intent;
}

// =============================================================
// Business hours — MVP approximation only (documented known gap: store
// profile's businessHours is free text today, no structured open/close
// schema to parse). Fixed 09:00–18:00 Asia/Bangkok window.
// =============================================================

function isWithinBusinessHours(now: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false }).format(now)
  );
  return hour >= 9 && hour < 18;
}

// =============================================================
// AI follow-up message generation
// -------------------------------------------------------------
// Section 7 of the spec: never "are you still interested?" — provide value
// specific to the rule's goal. Falls back to rule.template, else a plain
// goal-labeled message, when there are no AI credentials/quota (same
// AI-then-template shape as generateResponse() in ai.ts).
// =============================================================

const GOAL_GUIDANCE: Record<MessageGoal, string> = {
  CLOSE_SALE:
    "Help the customer decide: recommend the specific product(s) discussed, mention real stock availability if known, and suggest a clear next step to buy.",
  COLLECT_MISSING_INFO:
    "Politely ask for exactly the one piece of information still missing to proceed (e.g. size, delivery address, payment method) — do not re-ask what they already gave.",
  CONTINUE_CONVERSATION:
    "Offer something genuinely useful related to what they were asking about — a related product, an answer to a likely follow-up question, or a helpful tip.",
  CONFIRM_BOOKING:
    "Confirm the booking details discussed and ask them to confirm, or offer to adjust the time/date if needed.",
  CUSTOMER_SATISFACTION:
    "Check whether their issue/complaint was actually resolved to their satisfaction. If they say no, they should feel comfortable saying so.",
  PAYMENT_REMINDER:
    "Gently remind them the order is awaiting payment, restate the amount and how to pay, without pressuring them.",
  RECOVER_ABANDONED_CART:
    "Remind them of the items still in their cart, mention stock/promotion if relevant, and make it easy to complete the order.",
  SUPPORT_FOLLOWUP:
    "Follow up on their support request — offer to help further or ask if anything is still unresolved.",
};

const GOAL_FALLBACK_TEXT: Record<MessageGoal, string> = {
  CLOSE_SALE: "รบกวนสอบถามเพิ่มเติมค่ะ สนใจสินค้าที่คุยกันไว้อยู่ไหมคะ ทางร้านพร้อมช่วยเช็คสต็อก/ราคาให้เลยค่ะ",
  COLLECT_MISSING_INFO: "ขออภัยที่รบกวนนะคะ ทางร้านยังขาดข้อมูลอีกเล็กน้อยเพื่อดำเนินการต่อ รบกวนแจ้งเพิ่มได้ไหมคะ",
  CONTINUE_CONVERSATION: "สวัสดีค่ะ มีอะไรให้ทางร้านช่วยเพิ่มเติมไหมคะ",
  CONFIRM_BOOKING: "รบกวนขอคอนเฟิร์มรายละเอียดการจองอีกครั้งค่ะ ถ้าสะดวกแจ้งกลับได้เลยนะคะ",
  CUSTOMER_SATISFACTION: "ขอสอบถามค่ะ ปัญหาที่แจ้งไว้ได้รับการแก้ไขเรียบร้อยดีไหมคะ",
  PAYMENT_REMINDER: "ขออนุญาตติดตามค่ะ ออร์เดอร์ของคุณยังรอการชำระเงินอยู่ค่ะ สะดวกโอนตอนนี้ไหมคะ",
  RECOVER_ABANDONED_CART: "สินค้าที่เลือกไว้ยังอยู่ในตะกร้านะคะ สนใจดำเนินการต่อไหมคะ ทางร้านพร้อมช่วยเช็คให้ค่ะ",
  SUPPORT_FOLLOWUP: "ขอติดตามค่ะ เรื่องที่แจ้งไว้ยังต้องการให้ทางร้านช่วยอะไรเพิ่มไหมคะ",
};

async function generateFollowupMessage(
  tenantId: string,
  conversationId: string,
  rule: FollowupRule,
  retryCount: number
): Promise<string> {
  const [conv, messages, history] = await Promise.all([
    getConversation(tenantId, conversationId),
    listMessages(tenantId, conversationId, 20),
    query<{ message_body: string | null; created_at: Date | string }>(
      `SELECT message_body, created_at FROM bms_followup_history
        WHERE conversation_id = $1 AND outcome = 'SENT'
        ORDER BY created_at DESC LIMIT 5`,
      [conversationId]
    ),
  ]);

  // Prepare all local context before reserving shared quota. A database/cache
  // failure here must not look like a provider call or charge the tenant.
  let customer360: Awaited<ReturnType<typeof getCustomer360>> | null;
  let storeProfile: Awaited<ReturnType<typeof getStoreProfile>>;
  try {
    [customer360, storeProfile] = await Promise.all([
      (conv as any)?.customer_id ? getCustomer360(tenantId, (conv as any).customer_id) : Promise.resolve(null),
      getStoreProfile(tenantId),
    ]);
  } catch (err) {
    console.error("[BMS] followup context load failed, falling back to template:", err);
    return rule.template?.trim() || GOAL_FALLBACK_TEXT[rule.messageGoal];
  }

  const creds = await resolveAiCredentials(tenantId, { surface: "system", feature: "followup_message" });
  if (!creds) return rule.template?.trim() || GOAL_FALLBACK_TEXT[rule.messageGoal];

  try {
    const transcript = messages
      .map((m: any) => `${m.direction === "IN" ? "customer" : "shop"}: ${(m.body || "").slice(0, 300)}`)
      .join("\n");
    const priorFollowups = history.rows.map((r) => r.message_body).filter(Boolean).join("\n---\n");

    const contextLines = [
      `Store: ${storeProfile.businessType ?? ""}, hours (as configured, free text): ${storeProfile.businessHours ?? "unknown"}`,
      `Conversation history:\n${transcript || "(no messages)"}`,
      customer360?.stats
        ? `Customer stats: lifetimeValue=${customer360.stats.lifetimeValue}, totalOrders=${customer360.stats.totalOrders}`
        : "Customer: unknown/new",
      `Current time: ${new Date().toISOString()}`,
      `Retry attempt: ${retryCount + 1} of ${rule.maxRetry}`,
      priorFollowups ? `Previous follow-up messages already sent (never repeat these):\n${priorFollowups}` : "No previous follow-ups sent yet.",
    ];

    if (creds.usageEventId) await recordAiProviderAttempt(creds.usageEventId);
    const resp = await callAnthropicCompatibleMessages(creds, {
      model: creds.model,
      max_tokens: 220,
      system:
        `You are a store assistant drafting ONE proactive follow-up message to a customer whose conversation went quiet. ` +
        `Goal: ${GOAL_GUIDANCE[rule.messageGoal]} ` +
        `Never simply ask "are you still interested?" — provide real value. Be natural, polite, concise, never pressure the customer, ` +
        `never repeat a previous follow-up message verbatim, and reply in the same language the customer was using. ` +
        `Reply with ONLY the message text, no preamble.`,
      messages: [{ role: "user", content: contextLines.join("\n\n") }],
    });
    if (!resp.ok) throw new Error(`${creds.provider} API ${resp.status}`);
    const json = (await resp.json()) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = json.content?.[0]?.text?.trim();
    if (!text) throw new Error(`${creds.provider} empty reply`);
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: "completed",
        inputTokens: json.usage?.input_tokens ?? null,
        outputTokens: json.usage?.output_tokens ?? null,
      });
    }
    return text;
  } catch (err) {
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "followup message generation failed",
      });
    }
    console.error("[BMS] followup message generation (AI) failed, falling back to template:", err);
    return rule.template?.trim() || GOAL_FALLBACK_TEXT[rule.messageGoal];
  }
}

// =============================================================
// Scheduler — cron entrypoint
// =============================================================

const CANDIDATE_BATCH = 200;
const DUE_JOB_BATCH = 100;
/**
 * นานแค่ไหนที่งานหนึ่งใบถือว่า "มีคนกำลังทำอยู่" หลังถูกเคลม — ต้องยาวกว่าเวลาที่ใช้สร้างข้อความ
 * ด้วย AI + ส่งออก channel จริง แต่สั้นพอให้งานที่ค้างเพราะ process ตายกลับมาทำใหม่ได้ไว
 */
const JOB_LEASE_MINUTES = 5;

type RunSummary = { scanned: number; sent: number; skipped: number; failed: number };

export type FollowupQueueEntry = {
  id: string;
  status: string;
  nextRunAt: string;
  retryCount: number;
  lastResult: string | null;
  conversationId: string;
  ruleId: string;
  intent: string;
  messageGoal: string;
  priority: number;
  maxRetry: number;
  businessHoursOnly: boolean;
  customerName: string | null;
  lastMessageAt: string | null;
  idleMinutes: number | null;
  customerLifetimeValue: number | null;
  totalOrders: number;
  score: number;
  scoreLabel: "HOT" | "WARM" | "COOL";
  scoreReasons: string[];
  createdAt: string;
  updatedAt: string;
};

export type FollowupAnalyticsBucket = {
  key: string;
  sent: number;
  replied: number;
  ordered: number;
  failed: number;
  skipped: number;
};

export type FollowupAnalyticsDaily = {
  day: string;
  sent: number;
  replied: number;
  ordered: number;
  failed: number;
  skipped: number;
};

export type FollowupAnalytics = {
  windowDays: number;
  activeJobs: number;
  pendingJobs: number;
  sentJobs: number;
  stoppedJobs: number;
  failedJobs: number;
  totalHistory: number;
  sentHistory: number;
  skippedHistory: number;
  failedHistory: number;
  repliedAfterFollowup: number;
  orderedAfterFollowup: number;
  replyRate: number;
  orderRate: number;
  avgRetryCount: number;
  avgIdleMinutesAtSend: number | null;
  byGoal: FollowupAnalyticsBucket[];
  byIntent: FollowupAnalyticsBucket[];
  daily: FollowupAnalyticsDaily[];
};

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreLabel(score: number): "HOT" | "WARM" | "COOL" {
  if (score >= 75) return "HOT";
  if (score >= 45) return "WARM";
  return "COOL";
}

function computeQueueScore(args: {
  priority: number;
  idleMinutes: number | null;
  retryCount: number;
  lastResult: string | null;
  customerLifetimeValue: number | null;
  totalOrders: number;
  businessHoursOnly: boolean;
}): { score: number; reasons: string[] } {
  let score = 40;
  const reasons: string[] = [];

  const idleMinutes = Math.max(0, Number(args.idleMinutes ?? 0));
  if (idleMinutes >= 24 * 60) {
    score += 22;
    reasons.push("ค้างมานานกว่า 24 ชั่วโมง");
  } else if (idleMinutes >= 4 * 60) {
    score += 15;
    reasons.push("ค้างมาหลายชั่วโมง");
  } else if (idleMinutes >= 60) {
    score += 8;
    reasons.push("เริ่มเงียบเกิน 1 ชั่วโมง");
  }

  if (args.priority > 0) {
    score += Math.min(15, args.priority * 4);
    reasons.push(`กฎมี priority ${args.priority}`);
  } else if (args.priority < 0) {
    score += Math.max(-10, args.priority * 3);
    reasons.push("กฎถูกลดความสำคัญไว้");
  }

  if ((args.customerLifetimeValue ?? 0) >= 10000) {
    score += 12;
    reasons.push("เป็นลูกค้ามูลค่าสูง");
  } else if ((args.customerLifetimeValue ?? 0) >= 3000) {
    score += 7;
    reasons.push("มีประวัติซื้อพอสมควร");
  }

  if (args.totalOrders === 0) {
    score += 5;
    reasons.push("เป็นโอกาสปิดการขายแรก");
  } else if (args.totalOrders >= 3) {
    score += 4;
    reasons.push("มีประวัติซื้อซ้ำ");
  }

  if (args.retryCount > 0) {
    score -= Math.min(18, args.retryCount * 8);
    reasons.push(`เคย follow-up แล้ว ${args.retryCount} ครั้ง`);
  }

  if (args.lastResult === "FAILED") {
    score -= 20;
    reasons.push("ครั้งล่าสุดส่งไม่สำเร็จ");
  }

  if (args.businessHoursOnly && !isWithinBusinessHours()) {
    score -= 8;
    reasons.push("กฎนี้รอเวลาทำการ");
  }

  return { score: clampScore(score), reasons };
}

async function scheduleNewJobs(tenantId?: string): Promise<number> {
  // conversations with no PENDING job at all, still open, and not last-answered by staff
  // (staff already engaged — don't auto-follow-up over a human)
  const candidates = await query<{ id: string; tenant_id: string; last_message_at: Date | string }>(
    `SELECT c.id, c.tenant_id, c.last_message_at
       FROM bms_conversations c
      WHERE c.status IN ('OPEN', 'PENDING')
        AND c.last_sender_type IS NOT NULL
        AND c.last_sender_type != 'staff'
        AND ($1::uuid IS NULL OR c.tenant_id = $1)
        AND NOT EXISTS (SELECT 1 FROM bms_followup_jobs j WHERE j.conversation_id = c.id AND j.status = 'PENDING')
      ORDER BY c.last_message_at ASC
      LIMIT ${CANDIDATE_BATCH}`,
    [tenantId ?? null]
  );

  let created = 0;
  for (const c of candidates.rows) {
    const intent = await getOrClassifyIntent(c.tenant_id, c.id);
    const rule = await matchRule(c.tenant_id, intent);
    if (!rule) continue; // no matching enabled rule — never invent one

    const res = await query(
      `INSERT INTO bms_followup_jobs (tenant_id, conversation_id, rule_id, next_run_at)
       VALUES ($1, $2, $3, $4::timestamptz + ($5 || ' minutes')::interval)
       ON CONFLICT (conversation_id, rule_id) WHERE status = 'PENDING' DO NOTHING
       RETURNING id`,
      [c.tenant_id, c.id, rule.id, c.last_message_at, rule.delayMinutes]
    );
    if (res.rowCount) created += 1;
  }
  return created;
}

async function processDueJobs(tenantId?: string): Promise<RunSummary> {
  const summary: RunSummary = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  const due = await query<{
    job_id: string;
    tenant_id: string;
    conversation_id: string;
    rule_id: string;
    retry_count: number;
    job_created_at: Date | string;
  }>(
    // เคลมงานก่อนทำ ไม่ใช่แค่ SELECT: การอ่านเฉย ๆ แล้วค่อยไปส่งข้อความทีหลัง แปลว่าถ้ามี
    // scheduler ยิงพร้อมกันสองทาง (cron ชนกับปุ่ม "รันตอนนี้", หรือ cron ยิงเข้า LB ที่มี web
    // หลาย instance) ทั้งสองฝั่งจะอ่านงานใบเดียวกันแล้ว **ส่งข้อความหาลูกค้าซ้ำ**
    //
    // เคลมด้วยการเลื่อน next_run_at ออกไปเป็น lease ไม่ใช่เปลี่ยน status เพราะ CHECK constraint
    // ของ bms_followup_jobs.status มีแค่ PENDING/SENT/STOPPED/FAILED (ไม่มี RUNNING) — ทำแบบนี้
    // จึงไม่ต้องมี migration ใหม่ · FOR UPDATE SKIP LOCKED ให้ instance ที่สแกนพร้อมกันข้ามแถวที่
    // ถูกจับไปแล้วแทนที่จะรอ · ถ้า process ตายกลางทาง lease หมดอายุแล้วงานกลับมาถึงกำหนดเอง
    `UPDATE bms_followup_jobs j
        SET next_run_at = now() + ($2 || ' minutes')::interval,
            updated_at = now()
      WHERE j.id IN (
        SELECT id FROM bms_followup_jobs
         WHERE status = 'PENDING' AND next_run_at <= now()
           AND ($1::uuid IS NULL OR tenant_id = $1)
         ORDER BY next_run_at ASC
         LIMIT ${DUE_JOB_BATCH}
         FOR UPDATE SKIP LOCKED
      )
     RETURNING j.id AS job_id, j.tenant_id, j.conversation_id, j.rule_id, j.retry_count,
               j.created_at AS job_created_at`,
    [tenantId ?? null, String(JOB_LEASE_MINUTES)]
  );

  for (const job of due.rows) {
    summary.scanned += 1;
    const ctx = systemActor(job.tenant_id);

    const [rule, convRow] = await Promise.all([
      query(`SELECT * FROM bms_followup_rules WHERE id = $1`, [job.rule_id]).then((r) => (r.rowCount ? mapRule(r.rows[0]) : null)),
      query<{ status: string; last_sender_type: string | null; last_message_at: Date | string; customer_id: string | null }>(
        `SELECT status, last_sender_type, last_message_at, customer_id FROM bms_conversations WHERE id = $1`,
        [job.conversation_id]
      ).then((r) => r.rows[0] ?? null),
    ]);

    const stop = async (reason: string) => {
      await query(`UPDATE bms_followup_jobs SET status = 'STOPPED', last_result = $2, updated_at = now() WHERE id = $1`, [job.job_id, reason]);
      await query(
        `INSERT INTO bms_followup_history (tenant_id, job_id, conversation_id, rule_id, outcome, reason, goal)
         VALUES ($1, $2, $3, $4, 'SKIPPED', $5, $6)`,
        [job.tenant_id, job.job_id, job.conversation_id, job.rule_id, reason, rule?.messageGoal ?? null]
      );
      await audit(ctx, "followup.skipped", job.conversation_id, { ruleId: job.rule_id, reason });
      summary.skipped += 1;
    };

    if (!convRow) {
      await stop("conversation_not_found");
      continue;
    }
    if (!rule || !rule.enabled) {
      await stop("rule_disabled");
      continue;
    }
    if (convRow.status === "CLOSED") {
      await stop("conversation_closed");
      continue;
    }
    const repliedSince = new Date(convRow.last_message_at).getTime() > new Date(job.job_created_at).getTime();
    if (repliedSince && convRow.last_sender_type === "customer") {
      await stop("customer_replied");
      continue;
    }
    if (repliedSince && convRow.last_sender_type === "staff") {
      await stop("staff_replied");
      continue;
    }
    if (convRow.customer_id) {
      const optOut = await query<{ followup_opt_out: boolean }>(
        `SELECT followup_opt_out FROM bms_customers WHERE id = $1`,
        [convRow.customer_id]
      );
      if (optOut.rows[0]?.followup_opt_out) {
        await stop("opted_out");
        continue;
      }
    }
    if (job.retry_count >= rule.maxRetry) {
      await stop("max_retry_exceeded");
      continue;
    }
    if (rule.businessHoursOnly && !isWithinBusinessHours()) {
      // just wait — doesn't consume a retry, doesn't log a skip
      continue;
    }

    try {
      const text = await generateFollowupMessage(job.tenant_id, job.conversation_id, rule, job.retry_count);
      const sendResult = await sendFollowupMessage(job.tenant_id, job.conversation_id, text, {
        ruleId: job.rule_id,
        jobId: job.job_id,
        goal: rule.messageGoal,
      });
      if (sendResult.status !== "SENT") {
        await query(`UPDATE bms_followup_jobs SET status = 'FAILED', last_result = $2, updated_at = now() WHERE id = $1`, [job.job_id, sendResult.status]);
        await query(
          `INSERT INTO bms_followup_history (tenant_id, job_id, conversation_id, rule_id, outcome, reason, goal)
           VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)`,
          [job.tenant_id, job.job_id, job.conversation_id, job.rule_id, sendResult.status, rule.messageGoal]
        );
        await audit(ctx, "followup.failed", job.conversation_id, { ruleId: job.rule_id, reason: sendResult.status });
        summary.failed += 1;
        continue;
      }

      const nextRetryCount = job.retry_count + 1;
      const done = nextRetryCount >= rule.maxRetry;
      await query(
        `UPDATE bms_followup_jobs
            SET retry_count = $2,
                status = CASE WHEN $3 THEN 'SENT' ELSE 'PENDING' END,
                next_run_at = CASE WHEN $3 THEN next_run_at ELSE now() + ($4 || ' minutes')::interval END,
                last_result = 'sent',
                updated_at = now()
          WHERE id = $1`,
        [job.job_id, nextRetryCount, done, rule.delayMinutes]
      );
      await query(
        `INSERT INTO bms_followup_history (tenant_id, job_id, conversation_id, rule_id, outcome, message_body, goal)
         VALUES ($1, $2, $3, $4, 'SENT', $5, $6)`,
        [job.tenant_id, job.job_id, job.conversation_id, job.rule_id, text, rule.messageGoal]
      );
      await audit(ctx, "followup.sent", job.conversation_id, { ruleId: job.rule_id, goal: rule.messageGoal, retry: nextRetryCount });
      summary.sent += 1;
    } catch (err) {
      console.error("[BMS] followup job failed:", err);
      await query(`UPDATE bms_followup_jobs SET status = 'FAILED', last_result = $2, updated_at = now() WHERE id = $1`, [
        job.job_id,
        err instanceof Error ? err.message.slice(0, 200) : "unknown error",
      ]);
      await query(
        `INSERT INTO bms_followup_history (tenant_id, job_id, conversation_id, rule_id, outcome, reason, goal)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)`,
        [job.tenant_id, job.job_id, job.conversation_id, job.rule_id, "exception", rule?.messageGoal ?? null]
      );
      summary.failed += 1;
    }
  }

  return summary;
}

export async function listFollowupQueue(tenantId: string, limit = 50): Promise<FollowupQueueEntry[]> {
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const res = await query<{
    id: string;
    status: string;
    next_run_at: Date | string;
    retry_count: number;
    last_result: string | null;
    conversation_id: string;
    rule_id: string;
    intent: string;
    message_goal: string;
    priority: number;
    max_retry: number;
    business_hours_only: boolean;
    customer_name: string | null;
    last_message_at: Date | string | null;
    customer_lifetime_value: string | number | null;
    total_orders: string | number | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT j.id, j.status, j.next_run_at, j.retry_count, j.last_result, j.created_at, j.updated_at,
            j.conversation_id, j.rule_id,
            r.intent, r.message_goal, r.priority, r.max_retry, r.business_hours_only,
            COALESCE(NULLIF(cu.name, c.customer_ref), ci.display_name) AS customer_name,
            c.last_message_at,
            stats.lifetime_value AS customer_lifetime_value,
            stats.total_orders
       FROM bms_followup_jobs j
       JOIN bms_followup_rules r ON r.id = j.rule_id
       JOIN bms_conversations c ON c.id = j.conversation_id
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = c.tenant_id AND ci.channel = c.channel AND ci.external_ref = c.customer_ref
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*)::int AS total_orders,
                COALESCE(SUM(total_amount), 0)::numeric AS lifetime_value
           FROM bms_orders
          WHERE tenant_id = $1 AND customer_id IS NOT NULL
          GROUP BY customer_id
       ) stats ON stats.customer_id = c.customer_id
      WHERE j.tenant_id = $1
      ORDER BY j.updated_at DESC
      LIMIT $2`,
    [tenantId, lim]
  );

  return res.rows.map((row) => {
    const lastMessageAt = row.last_message_at ? new Date(row.last_message_at) : null;
    const idleMinutes = lastMessageAt ? Math.max(0, Math.floor((Date.now() - lastMessageAt.getTime()) / 60000)) : null;
    const { score, reasons } = computeQueueScore({
      priority: Number(row.priority ?? 0),
      idleMinutes,
      retryCount: Number(row.retry_count ?? 0),
      lastResult: row.last_result ?? null,
      customerLifetimeValue: row.customer_lifetime_value != null ? Number(row.customer_lifetime_value) : null,
      totalOrders: Number(row.total_orders ?? 0),
      businessHoursOnly: Boolean(row.business_hours_only),
    });

    return {
      id: row.id,
      status: row.status,
      nextRunAt: new Date(row.next_run_at).toISOString(),
      retryCount: Number(row.retry_count ?? 0),
      lastResult: row.last_result ?? null,
      conversationId: row.conversation_id,
      ruleId: row.rule_id,
      intent: row.intent,
      messageGoal: row.message_goal,
      priority: Number(row.priority ?? 0),
      maxRetry: Number(row.max_retry ?? 0),
      businessHoursOnly: Boolean(row.business_hours_only),
      customerName: row.customer_name ?? null,
      lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null,
      idleMinutes,
      customerLifetimeValue: row.customer_lifetime_value != null ? Number(row.customer_lifetime_value) : null,
      totalOrders: Number(row.total_orders ?? 0),
      score,
      scoreLabel: scoreLabel(score),
      scoreReasons: reasons,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

export async function getFollowupAnalytics(tenantId: string, windowDays = 30): Promise<FollowupAnalytics> {
  const days = Math.min(Math.max(Number(windowDays || 30), 1), 365);
  const sinceExpr = `now() - ($2::int || ' days')::interval`;

  const [jobCounts, historyCounts, goalCounts, intentCounts, dailyCounts, avgCounts] = await Promise.all([
    query<{
      active_jobs: string;
      pending_jobs: string;
      sent_jobs: string;
      stopped_jobs: string;
      failed_jobs: string;
      avg_retry_count: string | null;
    }>(
      `SELECT COUNT(*)::int AS active_jobs,
              COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_jobs,
              COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent_jobs,
              COUNT(*) FILTER (WHERE status = 'STOPPED')::int AS stopped_jobs,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_jobs,
              AVG(retry_count::numeric) AS avg_retry_count
         FROM bms_followup_jobs
        WHERE tenant_id = $1`,
      [tenantId]
    ),
    query<{
      total_history: string;
      sent_history: string;
      skipped_history: string;
      failed_history: string;
      replied_after_followup: string;
      ordered_after_followup: string;
    }>(
      `SELECT COUNT(*)::int AS total_history,
              COUNT(*) FILTER (WHERE h.outcome = 'SENT')::int AS sent_history,
              COUNT(*) FILTER (WHERE h.outcome = 'SKIPPED')::int AS skipped_history,
              COUNT(*) FILTER (WHERE h.outcome = 'FAILED')::int AS failed_history,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_messages m
                   WHERE m.tenant_id = h.tenant_id
                     AND m.conversation_id = h.conversation_id
                     AND m.direction = 'IN'
                     AND m.created_at > h.created_at
                     AND m.created_at <= h.created_at + interval '7 days'
                )
              )::int AS replied_after_followup,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_conversations c
                    JOIN bms_orders o
                      ON o.tenant_id = c.tenant_id
                     AND o.customer_id = c.customer_id
                   WHERE c.id = h.conversation_id
                     AND c.customer_id IS NOT NULL
                     AND o.created_at > h.created_at
                     AND o.created_at <= h.created_at + interval '7 days'
                )
              )::int AS ordered_after_followup
         FROM bms_followup_history h
        WHERE h.tenant_id = $1
          AND h.created_at >= ${sinceExpr}`,
      [tenantId, days]
    ),
    query<{
      key: string | null;
      sent: string;
      replied: string;
      ordered: string;
      failed: string;
      skipped: string;
    }>(
      `SELECT COALESCE(h.goal, 'UNKNOWN') AS key,
              COUNT(*) FILTER (WHERE h.outcome = 'SENT')::int AS sent,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_messages m
                   WHERE m.tenant_id = h.tenant_id
                     AND m.conversation_id = h.conversation_id
                     AND m.direction = 'IN'
                     AND m.created_at > h.created_at
                     AND m.created_at <= h.created_at + interval '7 days'
                )
              )::int AS replied,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_conversations c
                    JOIN bms_orders o
                      ON o.tenant_id = c.tenant_id
                     AND o.customer_id = c.customer_id
                   WHERE c.id = h.conversation_id
                     AND c.customer_id IS NOT NULL
                     AND o.created_at > h.created_at
                     AND o.created_at <= h.created_at + interval '7 days'
                )
              )::int AS ordered,
              COUNT(*) FILTER (WHERE h.outcome = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE h.outcome = 'SKIPPED')::int AS skipped
         FROM bms_followup_history h
        WHERE h.tenant_id = $1
          AND h.created_at >= ${sinceExpr}
        GROUP BY COALESCE(h.goal, 'UNKNOWN')
        ORDER BY sent DESC, key ASC`,
      [tenantId, days]
    ),
    query<{
      key: string | null;
      sent: string;
      replied: string;
      ordered: string;
      failed: string;
      skipped: string;
    }>(
      `SELECT COALESCE(r.intent, 'UNKNOWN') AS key,
              COUNT(*) FILTER (WHERE h.outcome = 'SENT')::int AS sent,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_messages m
                   WHERE m.tenant_id = h.tenant_id
                     AND m.conversation_id = h.conversation_id
                     AND m.direction = 'IN'
                     AND m.created_at > h.created_at
                     AND m.created_at <= h.created_at + interval '7 days'
                )
              )::int AS replied,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_conversations c
                    JOIN bms_orders o
                      ON o.tenant_id = c.tenant_id
                     AND o.customer_id = c.customer_id
                   WHERE c.id = h.conversation_id
                     AND c.customer_id IS NOT NULL
                     AND o.created_at > h.created_at
                     AND o.created_at <= h.created_at + interval '7 days'
                )
              )::int AS ordered,
              COUNT(*) FILTER (WHERE h.outcome = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE h.outcome = 'SKIPPED')::int AS skipped
         FROM bms_followup_history h
         LEFT JOIN bms_followup_rules r ON r.id = h.rule_id
        WHERE h.tenant_id = $1
          AND h.created_at >= ${sinceExpr}
        GROUP BY COALESCE(r.intent, 'UNKNOWN')
        ORDER BY sent DESC, key ASC`,
      [tenantId, days]
    ),
    query<{
      day: string;
      sent: string;
      replied: string;
      ordered: string;
      failed: string;
      skipped: string;
    }>(
      `SELECT to_char(date_trunc('day', h.created_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE h.outcome = 'SENT')::int AS sent,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_messages m
                   WHERE m.tenant_id = h.tenant_id
                     AND m.conversation_id = h.conversation_id
                     AND m.direction = 'IN'
                     AND m.created_at > h.created_at
                     AND m.created_at <= h.created_at + interval '7 days'
                )
              )::int AS replied,
              COUNT(*) FILTER (
                WHERE h.outcome = 'SENT' AND EXISTS (
                  SELECT 1
                    FROM bms_conversations c
                    JOIN bms_orders o
                      ON o.tenant_id = c.tenant_id
                     AND o.customer_id = c.customer_id
                   WHERE c.id = h.conversation_id
                     AND c.customer_id IS NOT NULL
                     AND o.created_at > h.created_at
                     AND o.created_at <= h.created_at + interval '7 days'
                )
              )::int AS ordered,
              COUNT(*) FILTER (WHERE h.outcome = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE h.outcome = 'SKIPPED')::int AS skipped
         FROM bms_followup_history h
        WHERE h.tenant_id = $1
          AND h.created_at >= ${sinceExpr}
        GROUP BY 1
        ORDER BY day DESC
        LIMIT 14`,
      [tenantId, days]
    ),
    query<{ avg_idle_minutes_at_send: string | null }>(
      `SELECT AVG(idle_minutes) AS avg_idle_minutes_at_send
         FROM (
           SELECT EXTRACT(
                    EPOCH FROM (
                      h.created_at - COALESCE(
                        (
                          SELECT MAX(m.created_at)
                            FROM bms_messages m
                           WHERE m.tenant_id = h.tenant_id
                             AND m.conversation_id = h.conversation_id
                             AND m.created_at < h.created_at
                        ),
                        h.created_at
                      )
                    )
                  ) / 60.0 AS idle_minutes
             FROM bms_followup_history h
            WHERE h.tenant_id = $1
              AND h.outcome = 'SENT'
              AND h.created_at >= ${sinceExpr}
         ) idle_samples`,
      [tenantId, days]
    ),
  ]);

  const jobs = jobCounts.rows[0];
  const history = historyCounts.rows[0];
  const sentHistory = Number(history?.sent_history ?? 0);

  return {
    windowDays: days,
    activeJobs: Number(jobs?.active_jobs ?? 0),
    pendingJobs: Number(jobs?.pending_jobs ?? 0),
    sentJobs: Number(jobs?.sent_jobs ?? 0),
    stoppedJobs: Number(jobs?.stopped_jobs ?? 0),
    failedJobs: Number(jobs?.failed_jobs ?? 0),
    totalHistory: Number(history?.total_history ?? 0),
    sentHistory,
    skippedHistory: Number(history?.skipped_history ?? 0),
    failedHistory: Number(history?.failed_history ?? 0),
    repliedAfterFollowup: Number(history?.replied_after_followup ?? 0),
    orderedAfterFollowup: Number(history?.ordered_after_followup ?? 0),
    replyRate: sentHistory > 0 ? roundRate(Number(history?.replied_after_followup ?? 0) / sentHistory) : 0,
    orderRate: sentHistory > 0 ? roundRate(Number(history?.ordered_after_followup ?? 0) / sentHistory) : 0,
    avgRetryCount: roundRate(Number(jobs?.avg_retry_count ?? 0)),
    avgIdleMinutesAtSend: avgCounts.rows[0]?.avg_idle_minutes_at_send != null
      ? roundRate(Number(avgCounts.rows[0].avg_idle_minutes_at_send))
      : null,
    byGoal: goalCounts.rows.map((row) => ({
      key: row.key ?? "UNKNOWN",
      sent: Number(row.sent ?? 0),
      replied: Number(row.replied ?? 0),
      ordered: Number(row.ordered ?? 0),
      failed: Number(row.failed ?? 0),
      skipped: Number(row.skipped ?? 0),
    })),
    byIntent: intentCounts.rows.map((row) => ({
      key: row.key ?? "UNKNOWN",
      sent: Number(row.sent ?? 0),
      replied: Number(row.replied ?? 0),
      ordered: Number(row.ordered ?? 0),
      failed: Number(row.failed ?? 0),
      skipped: Number(row.skipped ?? 0),
    })),
    daily: dailyCounts.rows
      .map((row) => ({
        day: row.day,
        sent: Number(row.sent ?? 0),
        replied: Number(row.replied ?? 0),
        ordered: Number(row.ordered ?? 0),
        failed: Number(row.failed ?? 0),
        skipped: Number(row.skipped ?? 0),
      }))
      .reverse(),
  };
}

/**
 * Cron entrypoint — scans every tenant itself (matches detectStaleChannels()/
 * runScheduledDigests()) when tenantId is omitted. The manual "run now" GraphQL
 * mutation passes its own tenantId so a tenant-scoped followup.manage grant
 * can't trigger (or observe side effects on) another tenant's conversations.
 */
export async function runDueFollowups(tenantId?: string): Promise<RunSummary> {
  await scheduleNewJobs(tenantId);
  return processDueJobs(tenantId);
}
