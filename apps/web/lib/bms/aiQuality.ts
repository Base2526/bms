import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export const AI_QUALITY_OUTCOMES = [
  "SUCCESS",
  "CLARIFICATION",
  "HANDOFF",
  "UNRESOLVED",
  "FAILURE",
] as const;
export type AiQualityOutcome = (typeof AI_QUALITY_OUTCOMES)[number];

export const AI_QUALITY_VERDICTS = ["PASS", "FAIL", "UNCLEAR"] as const;
export type AiQualityVerdict = (typeof AI_QUALITY_VERDICTS)[number];

export const AI_QUALITY_CATEGORIES = [
  "CORRECT",
  "HALLUCINATION",
  "WRONG_TOOL",
  "TOOL_ERROR",
  "MISUNDERSTOOD",
  "BAD_HANDOFF",
  "POLICY",
  "TONE",
  "OTHER",
] as const;
export type AiQualityCategory = (typeof AI_QUALITY_CATEGORIES)[number];

export type AiTurnQuality = {
  outcome: AiQualityOutcome;
  reasonCodes: string[];
  successfulToolCalls: number;
  failedToolCalls: number;
};

type QualityInput = {
  tool: string;
  reply: string;
  order?: { status?: string } | null;
  trace?: Array<{ tool: string; ok: boolean; summary?: string }> | null;
};

const HANDOFF_TEXT = "ขอให้แอดมินช่วยตอบต่อ";
const GENERIC_RETRY =
  /(?:ช่วยพิมพ์ใหม่|ลองใหม่อีกครั้ง|ถามอีกครั้ง|ระบบยังไม่ได้บันทึกให้จริง|ขอเช็คข้อมูลให้แน่ใจ)/i;
const CLARIFICATION =
  /(?:ไซซ์|size|ขนาด|จำนวน|กี่ชิ้น|กี่คู่|รุ่นไหน|ชื่อสินค้า|ช่องทาง.*(?:โอน|ชำระ)|วิธี.*(?:โอน|ชำระ)).*(?:คะ|ค่ะ|\?)/is;

/** Derive bounded, non-PII labels from a completed pipeline turn. */
export function deriveAiTurnQuality(input: QualityInput): AiTurnQuality {
  const trace = input.trace ?? [];
  const successfulToolCalls = trace.filter((item) => item.ok).length;
  const failedToolCalls = trace.filter((item) => !item.ok).length;
  const reasons: string[] = [];

  if (input.reply.includes(HANDOFF_TEXT)) {
    reasons.push("FORCED_HANDOFF");
    return { outcome: "HANDOFF", reasonCodes: reasons, successfulToolCalls, failedToolCalls };
  }

  if (failedToolCalls > 0) reasons.push("TOOL_ERROR");
  if (GENERIC_RETRY.test(input.reply)) reasons.push("SAFE_GUARD_OR_RETRY");

  if (failedToolCalls > 0 && successfulToolCalls === 0) {
    return { outcome: "FAILURE", reasonCodes: reasons, successfulToolCalls, failedToolCalls };
  }
  if (GENERIC_RETRY.test(input.reply)) {
    return { outcome: "UNRESOLVED", reasonCodes: reasons, successfulToolCalls, failedToolCalls };
  }
  if (CLARIFICATION.test(input.reply)) {
    reasons.push("ASKED_CLARIFICATION");
    return { outcome: "CLARIFICATION", reasonCodes: reasons, successfulToolCalls, failedToolCalls };
  }

  if (input.order?.status === "CREATED") reasons.push("ORDER_CREATED");
  else if (successfulToolCalls > 0) reasons.push("VERIFIED_TOOL_RESULT");
  else if (input.tool.startsWith("deterministic:")) reasons.push("DETERMINISTIC_REPLY");
  else reasons.push("ANSWERED");

  return { outcome: "SUCCESS", reasonCodes: reasons, successfulToolCalls, failedToolCalls };
}

function severityFor(outcome: AiQualityOutcome): "LOW" | "MEDIUM" | "HIGH" {
  if (outcome === "FAILURE") return "HIGH";
  if (outcome === "HANDOFF" || outcome === "UNRESOLVED") return "MEDIUM";
  return "LOW";
}

/** Queue every failure signal and a stable ~5% sample of normal turns. */
export async function enqueueAiQualityReview(
  tenantId: string,
  conversationId: string,
  messageId: string,
  quality: AiTurnQuality
): Promise<void> {
  const isFailure = ["FAILURE", "HANDOFF", "UNRESOLVED"].includes(quality.outcome);
  let sampled = false;
  try {
    sampled = BigInt(messageId) % 20n === 0n;
  } catch {
    sampled = false;
  }
  if (!isFailure && !sampled) return;

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    // The queue is operational metadata, not permanent chat history. Source
    // message retention remains owned by the Inbox policy.
    await client.query(
      `DELETE FROM bms_ai_quality_reviews
        WHERE tenant_id = $1
          AND created_at < now() - interval '180 days'`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO bms_ai_quality_reviews (
         tenant_id, conversation_id, message_id, source, signal_outcome, reason_codes, severity
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        tenantId,
        conversationId,
        messageId,
        isFailure ? "AUTO_FAILURE" : "AUTO_SAMPLE",
        quality.outcome,
        quality.reasonCodes,
        severityFor(quality.outcome),
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function redactQualityText(value: string | null | undefined, maxLength = 500): string {
  const redacted = String(value || "")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(?:\+?66|0)[-\s]?\d{1,2}[-\s]?\d{3}[-\s]?\d{4}/g, "[PHONE]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[ID]")
    .replace(/\b\d{9,}\b/g, "[NUMBER]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

const QUALITY_CASE_SELECT = `
  SELECT r.id, r.conversation_id, r.message_id, r.source, r.signal_outcome,
         r.reason_codes, r.severity, r.status, r.verdict, r.category,
         r.reviewer_note, r.reviewed_at, r.created_at, r.updated_at,
         c.channel, c.status AS conversation_status,
         ai.body AS ai_body,
         customer.body AS customer_body,
         reviewer.name AS reviewer_name
    FROM bms_ai_quality_reviews r
    JOIN bms_conversations c
      ON c.tenant_id = r.tenant_id AND c.id = r.conversation_id
    JOIN bms_messages ai
      ON ai.tenant_id = r.tenant_id AND ai.id = r.message_id
    LEFT JOIN LATERAL (
      SELECT m.body
        FROM bms_messages m
       WHERE m.tenant_id = r.tenant_id
         AND m.conversation_id = r.conversation_id
         AND m.direction = 'IN'
         AND (m.created_at, m.id) <= (ai.created_at, ai.id)
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) customer ON true
    LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by`;

function mapCase(row: any) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: String(row.message_id),
    channel: row.channel,
    conversationStatus: row.conversation_status,
    source: row.source,
    signalOutcome: row.signal_outcome,
    reasonCodes: row.reason_codes ?? [],
    severity: row.severity,
    status: row.status,
    verdict: row.verdict ?? null,
    category: row.category ?? null,
    customerPreview: redactQualityText(row.customer_body, 240),
    aiPreview: redactQualityText(row.ai_body, 240),
    reviewerNote: row.reviewer_note ?? null,
    reviewerName: row.reviewer_name ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listAiQualityCases(
  tenantId: string,
  opts: {
    days?: number;
    status?: string | null;
    source?: string | null;
    outcome?: string | null;
    limit?: number;
    offset?: number;
  } = {}
) {
  const days = Math.min(Math.max(Number(opts.days ?? 30), 1), 90);
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const result = await query<any>(
    `${QUALITY_CASE_SELECT}
      WHERE r.tenant_id = $1
        AND r.created_at >= now() - ($2 || ' days')::interval
        AND ($3::text IS NULL OR r.status = $3)
        AND ($4::text IS NULL OR r.source = $4)
        AND ($5::text IS NULL OR r.signal_outcome = $5)
      ORDER BY
        CASE r.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        r.created_at DESC
      LIMIT $6 OFFSET $7`,
    [
      tenantId,
      days,
      opts.status ?? null,
      opts.source ?? null,
      opts.outcome ?? null,
      limit,
      offset,
    ]
  );
  return result.rows.map(mapCase);
}

export async function getAiQualityCase(tenantId: string, id: string) {
  const result = await query<any>(
    `${QUALITY_CASE_SELECT}
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, id]
  );
  const row = result.rows[0];
  if (!row) return null;

  const messages = await query<any>(
    `SELECT id, direction, sender, body, created_at
       FROM (
         SELECT m.id, m.direction, m.sender, m.body, m.created_at
           FROM bms_messages m
           JOIN bms_messages target
             ON target.tenant_id = m.tenant_id AND target.id = $3
          WHERE m.tenant_id = $1
            AND m.conversation_id = $2
          ORDER BY ABS(EXTRACT(EPOCH FROM (m.created_at - target.created_at))), m.id
          LIMIT 20
       ) nearby
      ORDER BY created_at, id`,
    [tenantId, row.conversation_id, String(row.message_id)]
  );
  return {
    ...mapCase(row),
    messages: messages.rows.map((message) => ({
      id: String(message.id),
      direction: message.direction,
      sender: message.sender ?? null,
      body: redactQualityText(message.body, 2000),
      createdAt: new Date(message.created_at).toISOString(),
    })),
  };
}

export async function getAiQualityMetrics(tenantId: string, days = 30) {
  const boundedDays = Math.min(Math.max(Number(days), 1), 90);
  const totals = await query<any>(
    `SELECT COUNT(*)::int AS total_turns,
            COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' = 'SUCCESS')::int AS success_count,
            COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' = 'CLARIFICATION')::int AS clarification_count,
            COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' = 'HANDOFF')::int AS handoff_count,
            COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' IN ('UNRESOLVED', 'FAILURE'))::int AS unresolved_count
       FROM bms_messages
      WHERE tenant_id = $1
        AND sender = 'ai'
        AND meta ? 'aiQuality'
        AND created_at >= now() - ($2 || ' days')::interval`,
    [tenantId, boundedDays]
  );
  const daily = await query<any>(
    `WITH days AS (
       SELECT generate_series(
         (now() AT TIME ZONE 'Asia/Bangkok')::date - ($2::int - 1),
         (now() AT TIME ZONE 'Asia/Bangkok')::date,
         interval '1 day'
       )::date AS day
     ),
     turns AS (
       SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
              COUNT(*)::int AS total_turns,
              COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' = 'SUCCESS')::int AS success_count,
              COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' = 'HANDOFF')::int AS handoff_count,
              COUNT(*) FILTER (WHERE meta->'aiQuality'->>'outcome' IN ('UNRESOLVED', 'FAILURE'))::int AS unresolved_count
         FROM bms_messages
        WHERE tenant_id = $1
          AND sender = 'ai'
          AND meta ? 'aiQuality'
          AND created_at >= now() - ($2 || ' days')::interval
        GROUP BY 1
     )
     SELECT days.day::text,
            COALESCE(turns.total_turns, 0)::int AS total_turns,
            COALESCE(turns.success_count, 0)::int AS success_count,
            COALESCE(turns.handoff_count, 0)::int AS handoff_count,
            COALESCE(turns.unresolved_count, 0)::int AS unresolved_count
       FROM days LEFT JOIN turns USING (day)
      ORDER BY days.day`,
    [tenantId, boundedDays]
  );
  const reviews = await query<any>(
    `SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_reviews,
            COUNT(*) FILTER (WHERE status = 'REVIEWED')::int AS reviewed_count,
            COUNT(*) FILTER (WHERE verdict = 'FAIL')::int AS human_fail_count
       FROM bms_ai_quality_reviews
      WHERE tenant_id = $1
        AND created_at >= now() - ($2 || ' days')::interval`,
    [tenantId, boundedDays]
  );

  const t = totals.rows[0] ?? {};
  const r = reviews.rows[0] ?? {};
  const totalTurns = Number(t.total_turns ?? 0);
  const rate = (count: number) =>
    totalTurns === 0 ? 0 : Math.round((count / totalTurns) * 1000) / 10;
  const successCount = Number(t.success_count ?? 0);
  const handoffCount = Number(t.handoff_count ?? 0);
  const unresolvedCount = Number(t.unresolved_count ?? 0);

  return {
    days: boundedDays,
    totalTurns,
    successCount,
    clarificationCount: Number(t.clarification_count ?? 0),
    handoffCount,
    unresolvedCount,
    successRate: rate(successCount),
    handoffRate: rate(handoffCount),
    unresolvedRate: rate(unresolvedCount),
    pendingReviews: Number(r.pending_reviews ?? 0),
    reviewedCount: Number(r.reviewed_count ?? 0),
    humanFailCount: Number(r.human_fail_count ?? 0),
    daily: daily.rows.map((row) => ({
      day: row.day,
      totalTurns: Number(row.total_turns),
      successCount: Number(row.success_count),
      handoffCount: Number(row.handoff_count),
      unresolvedCount: Number(row.unresolved_count),
    })),
  };
}

export async function reviewAiQualityCase(
  tenantId: string,
  id: string,
  input: {
    verdict: AiQualityVerdict;
    category: AiQualityCategory;
    note?: string | null;
    reviewerId?: string | null;
  }
) {
  const note = String(input.note || "").trim();
  if (note.length > 1000) throw new Error("หมายเหตุยาวเกิน 1,000 ตัวอักษร");
  if (input.verdict === "PASS" && input.category !== "CORRECT") {
    throw new Error("ผล PASS ต้องใช้หมวด CORRECT");
  }
  if (input.verdict === "FAIL" && input.category === "CORRECT") {
    throw new Error("ผล FAIL ต้องระบุหมวดปัญหา");
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, input.reviewerId ? { editorId: input.reviewerId } : undefined);
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_ai_quality_reviews
          SET status = 'REVIEWED',
              verdict = $3,
              category = $4,
              reviewer_note = NULLIF($5, ''),
              reviewed_by = $6,
              reviewed_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id`,
      [tenantId, id, input.verdict, input.category, note, input.reviewerId ?? null]
    );
    if (!updated.rowCount) throw new Error("ไม่พบ AI quality case");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  return getAiQualityCase(tenantId, id);
}

export async function dismissAiQualityCase(
  tenantId: string,
  id: string,
  reviewerId: string | null
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, reviewerId ? { editorId: reviewerId } : undefined);
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_ai_quality_reviews
          SET status = 'DISMISSED',
              verdict = NULL,
              category = NULL,
              reviewer_note = NULL,
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id`,
      [tenantId, id, reviewerId]
    );
    if (!updated.rowCount) throw new Error("ไม่พบ AI quality case");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  return getAiQualityCase(tenantId, id);
}
