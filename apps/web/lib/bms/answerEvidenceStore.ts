import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { redactQualityText } from "./aiQuality";
import { replyDigest, type TurnEvidence, type EvidenceStatus } from "./customerAnswerEvidence";

export async function getAnswerEvidenceCoverage(tenantId: string, days = 30) {
  const boundedDays = Math.min(90, Math.max(1, Number.isFinite(days) ? days : 30));
  const result = await query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE meta->'aiEvidence'->>'status'='COMPLETE')::int AS complete,
    COUNT(*) FILTER (WHERE meta->'aiEvidence'->>'status'='PARTIAL')::int AS partial,
    COUNT(*) FILTER (WHERE meta->'aiEvidence'->>'status'='FAILED')::int AS failed,
    COUNT(*) FILTER (WHERE COALESCE(meta->'aiEvidence'->>'status','NOT_CAPTURED')='NOT_CAPTURED')::int AS not_captured
    FROM bms_messages WHERE tenant_id=$1 AND direction='OUT' AND sender='ai'
      AND created_at >= now() - ($2 * interval '1 day')`, [tenantId,boundedDays]);
  return { ...result.rows[0], days: boundedDays, denominator: "ALL_AI_OUT_MESSAGES", accuracyVerdict: false };
}

/** Called inside the message transaction; caller owns the savepoint and failure marker. */
export async function persistAnswerEvidence(client: PoolClient, tenantId: string, conversationId: string,
  inputId: string, outputId: string, reply: string, evidence: TurnEvidence) {
  if (tenantId !== evidence.tenantId) throw new Error("EVIDENCE_TENANT_MISMATCH");
  const pair = await client.query(`SELECT id,direction,sender,body FROM bms_messages
    WHERE tenant_id=$1 AND conversation_id=$2 AND id IN ($3,$4) FOR SHARE`,
    [tenantId,conversationId,inputId,outputId]);
  const incoming = pair.rows.find(row => String(row.id) === inputId);
  const outgoing = pair.rows.find(row => String(row.id) === outputId);
  if (incoming?.direction !== "IN" || incoming.sender !== "customer" ||
      outgoing?.direction !== "OUT" || outgoing.sender !== "ai" || outgoing.body !== reply) {
    throw new Error("EVIDENCE_MESSAGE_PAIR_MISMATCH");
  }
  // Keep the pipeline's digest: hashing only here would bless a reply changed after capture.
  const reasons = [...evidence.reasons];
  let status: EvidenceStatus = evidence.status;
  if (!evidence.replyHash) { status = "PARTIAL"; reasons.push("REPLY_DIGEST_NOT_CAPTURED"); }
  else if (evidence.replyHash !== replyDigest(reply)) { status = "FAILED"; reasons.push("REPLY_DIGEST_MISMATCH"); }
  await client.query(`INSERT INTO bms_ai_turn_evidence
    (tenant_id,id,conversation_id,input_message_id,output_message_id,origin,status,reasons,attempted_calls,captured_calls,
     schema_version,reply_hash,started_at,finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
    [tenantId,evidence.id,conversationId,inputId,outputId,evidence.origin,status,JSON.stringify(reasons),
      evidence.attemptedCalls,evidence.calls.length,evidence.version,evidence.replyHash ?? "",evidence.startedAt,evidence.finishedAt ?? new Date().toISOString()]);
  if (evidence.calls.length) {
    await client.query(`INSERT INTO bms_ai_tool_evidence
      (tenant_id,turn_id,sequence,call_id,tool,source,outcome,safe_input,safe_output,reasons,projection_version,started_at,finished_at,payload_bytes,omissions)
      SELECT $1,$2,c.sequence,c.id,c.tool,c.source,c.outcome,c.input,c.output,c.reasons,c."projectionVersion",c."startedAt",c."finishedAt",c.bytes,c.omissions
      FROM jsonb_to_recordset($3::jsonb) AS c(sequence int,id uuid,tool text,source text,outcome text,input jsonb,output jsonb,
        reasons jsonb,"projectionVersion" int,"startedAt" timestamptz,"finishedAt" timestamptz,bytes int,omissions jsonb)`,
      [tenantId,evidence.id,JSON.stringify(evidence.calls)]);
  }
  return { status, reasons };
}

/** ai_quality.view is enforced by the adapter. Same-tenant lookup includes non-sampled turns. */
export async function getAnswerEvidence(tenantId: string, messageId: string) {
  if (!/^[1-9]\d{0,18}$/.test(messageId) || BigInt(messageId) > BigInt("9223372036854775807")) return null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    const messages = await client.query(`SELECT ai.id, ai.body, ai.meta, ai.created_at,
      customer.body AS question, customer.id AS input_id
      FROM bms_messages ai LEFT JOIN bms_messages customer
        ON customer.tenant_id = ai.tenant_id AND customer.conversation_id = ai.conversation_id
        AND customer.id::text = ai.meta->'aiEvidence'->>'inputMessageId' AND customer.direction = 'IN' AND customer.sender = 'customer'
      WHERE ai.tenant_id = $1 AND ai.id = $2 AND ai.direction = 'OUT' AND ai.sender = 'ai'`, [tenantId,messageId]);
    const message = messages.rows[0];
    if (!message) { await client.query("COMMIT"); return null; }
    const meta = message.meta?.aiEvidence;
    const base = { messageId, inputMessageId: message.input_id ? String(message.input_id) : null,
      question: redactQualityText(message.question ?? "", 4000), reply: redactQualityText(message.body, 4000),
      status: meta?.status ?? "NOT_CAPTURED", reasons: meta?.reasons ?? [], delivery: "UNKNOWN",
      turn: null as unknown, calls: [] as unknown[], replyMatches: null as boolean | null };
    if (!meta?.turnId) { await client.query("COMMIT"); return base; }
    await client.query("SAVEPOINT evidence_read");
    try {
      const header = await client.query(`SELECT id,input_message_id,origin,status,reasons,attempted_calls,captured_calls,schema_version,
        reply_hash,started_at,finished_at,snapshot_expires_at,expires_at
        FROM bms_ai_turn_evidence WHERE tenant_id=$1 AND output_message_id=$2 FOR SHARE`, [tenantId,messageId]);
      const row = header.rows[0];
      if (row) {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          base.status = "EXPIRED"; base.reasons = ["HEADER_EXPIRED"];
          await client.query("RELEASE SAVEPOINT evidence_read");
          await client.query("COMMIT"); return base;
        }
        const expired = new Date(row.snapshot_expires_at).getTime() <= Date.now();
        const calls = expired ? { rows: [] } : await client.query(`SELECT sequence,call_id,tool,source,outcome,
          safe_input,safe_output,reasons,projection_version,started_at,finished_at,payload_bytes,omissions FROM bms_ai_tool_evidence
          WHERE tenant_id=$1 AND turn_id=$2 ORDER BY sequence LIMIT 21`, [tenantId,row.id]);
        base.status = expired ? "EXPIRED" : row.status;
        base.reasons = row.reasons;
        const { reply_hash, input_message_id, ...publicHeader } = row;
        base.turn = publicHeader; base.calls = calls.rows;
        base.replyMatches = reply_hash ? reply_hash === replyDigest(message.body) : null;
        const integrityReasons: string[] = [];
        if (String(row.id) !== meta.turnId || String(input_message_id) !== base.inputMessageId) integrityReasons.push("MESSAGE_LINK_MISMATCH");
        if (base.replyMatches === false) integrityReasons.push("REPLY_DIGEST_MISMATCH");
        if (!expired && (calls.rows.length !== row.captured_calls ||
            (row.status === "COMPLETE" && row.attempted_calls !== row.captured_calls) ||
            calls.rows.some(call => call.sequence > row.attempted_calls))) integrityReasons.push("CALL_SNAPSHOT_MISMATCH");
        if (integrityReasons.length) {
          base.status = "FAILED"; base.reasons = [...new Set([...base.reasons, ...integrityReasons])];
          // Do not present another turn's facts beside an unverified question.
          if (integrityReasons.includes("MESSAGE_LINK_MISMATCH")) { base.calls = []; base.turn = null; base.question = ""; base.inputMessageId = null; }
        }
      } else if (Date.now() - new Date(message.created_at).getTime() >= 180 * 86400000) base.status = "EXPIRED";
      else if (base.status !== "FAILED") { base.status = "FAILED"; base.reasons = ["HEADER_MISSING"]; }
      await client.query("RELEASE SAVEPOINT evidence_read");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT evidence_read");
      if ((error as { code?: string }).code !== "42P01") throw error;
      base.status = "FAILED"; base.reasons = ["SCHEMA_NOT_READY"];
    }
    await client.query("COMMIT");
    return base;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Cron only, bounded tenant pagination. Never disable RLS to run fleet retention. */
export async function purgeAnswerEvidence(afterTenant: string | null = null) {
  const tenants = await query<{ id: string }>(`SELECT id FROM bms_tenants
    WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 50`, [afterTenant]);
  let expired = 0, deleted = 0;
  let previousTenant = afterTenant;
  for (const tenant of tenants.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, tenant.id);
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const rows = await client.query(`SELECT id,expires_at FROM bms_ai_turn_evidence
        WHERE tenant_id=$1 AND ((snapshot_expires_at <= now() AND status <> 'EXPIRED') OR expires_at <= now())
        ORDER BY snapshot_expires_at LIMIT 500 FOR UPDATE SKIP LOCKED`, [tenant.id]);
      if (rows.rows.length) {
        const ids = rows.rows.map(row => row.id);
        await client.query(`DELETE FROM bms_ai_tool_evidence WHERE tenant_id=$1 AND turn_id=ANY($2::uuid[])`, [tenant.id,ids]);
        const removed = await client.query(`DELETE FROM bms_ai_turn_evidence WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND expires_at <= now()`, [tenant.id,ids]);
        const changed = await client.query(`UPDATE bms_ai_turn_evidence SET status='EXPIRED' WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [tenant.id,ids]);
        deleted += removed.rowCount ?? 0; expired += changed.rowCount ?? 0;
      }
      await client.query("COMMIT");
      // Drain a full tenant batch on the next bounded request before advancing the fleet cursor.
      if (rows.rows.length === 500) return { expired, deleted, nextTenant: previousTenant ?? "00000000-0000-0000-0000-000000000000" };
      previousTenant = tenant.id;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return { expired, deleted, nextTenant: tenants.rows.length === 50 ? tenants.rows[49].id : null };
}
