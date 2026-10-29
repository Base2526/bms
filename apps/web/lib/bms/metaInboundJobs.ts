import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getChannel } from "./channels";
import { runPipeline } from "./pipeline";
import {
  deliverToChannel,
  logConversation,
  logInboundMessage,
  type Attachment,
} from "./inbox";
import { fallbackEvidenceQuality } from "./customerAnswerEvidence";
import { recordInboundEvent } from "./channelHealth";
import { reportBmsFailure } from "./failureAlert";
import type { MetaEvent } from "./meta";

const META_CHANNELS = new Set(["facebook", "instagram"]);
const LEASE_MS = 5 * 60_000;

type StoredAttachment = MetaEvent["attachments"][number];

export type MetaInboundJob = {
  id: string;
  tenantId: string;
  channel: "facebook" | "instagram";
  eventId: string;
  externalAccountId: string;
  customerRef: string;
  messageText: string;
  attachments: StoredAttachment[];
  attempts: number;
};

function assertChannel(channel: string): asserts channel is MetaInboundJob["channel"] {
  if (!META_CHANNELS.has(channel)) throw new Error("unsupported Meta inbound channel");
}

function boundedEvent(event: MetaEvent): MetaEvent {
  if (!event.eventId || event.eventId.length > 256) throw new Error("invalid Meta event id");
  if (!/^\d{5,32}$/.test(event.externalAccountId)) throw new Error("invalid Meta Page id");
  if (!/^\d{5,64}$/.test(event.senderId)) throw new Error("invalid Meta sender id");
  if (event.text.length > 20_000) throw new Error("Meta message is too long");
  if (event.attachments.length > 10) throw new Error("too many Meta attachments");
  return {
    ...event,
    attachments: event.attachments.map((attachment) => ({
      type: attachment.type?.slice(0, 64) ?? null,
      url: attachment.url?.slice(0, 4096) ?? null,
      title: attachment.title?.slice(0, 500) ?? null,
      mimeType: attachment.mimeType?.slice(0, 255) ?? null,
    })),
  };
}

/** Persist only the bounded message fields the worker needs, never the raw signed payload. */
export async function enqueueMetaInboundEvents(
  tenantId: string,
  channel: string,
  events: MetaEvent[],
): Promise<{ accepted: number; duplicates: number }> {
  assertChannel(channel);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    let accepted = 0;
    for (const rawEvent of events) {
      const event = boundedEvent(rawEvent);
      const inserted = await client.query(
        `INSERT INTO bms_channel_inbound_jobs
           (tenant_id,channel,external_event_id,external_account_id,customer_ref,message_text,attachments)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (tenant_id,channel,external_event_id) DO NOTHING`,
        [tenantId, channel, event.eventId, event.externalAccountId, event.senderId,
          event.text, JSON.stringify(event.attachments)],
      );
      accepted += inserted.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { accepted, duplicates: events.length - accepted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimForTenant(tenantId: string): Promise<MetaInboundJob | null> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    // Once the AI/business pipeline starts, an unknown outcome must not be replayed: the first
    // attempt may already have created an order or reserved stock. Surface it for manual review.
    const expired = await client.query(
      `UPDATE bms_channel_inbound_jobs
          SET status='DEAD',lease_until=NULL,last_error_code='UNKNOWN_OUTCOME_AFTER_EFFECTS',completed_at=now()
        WHERE tenant_id=$1 AND status='PROCESSING' AND lease_until<now() AND effects_started_at IS NOT NULL
        RETURNING id`,
      [tenantId],
    );
    const selected = await client.query<any>(
      `SELECT id,tenant_id,channel,external_event_id,external_account_id,customer_ref,
              message_text,attachments,attempts
         FROM bms_channel_inbound_jobs j
        WHERE tenant_id=$1 AND available_at<=now()
          AND effects_started_at IS NULL
          AND (status IN ('PENDING','FAILED') OR (status='PROCESSING' AND lease_until<now()))
          AND NOT EXISTS (
            SELECT 1 FROM bms_channel_inbound_jobs previous
             WHERE previous.tenant_id=$1 AND previous.channel=j.channel
               AND previous.customer_ref=j.customer_ref
               AND previous.status IN ('PENDING','FAILED','PROCESSING')
               AND (previous.created_at,previous.id)<(j.created_at,j.id)
          )
        ORDER BY created_at,id
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [tenantId],
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      if (expired.rowCount) await reportExpiredJobs(tenantId);
      return null;
    }
    await client.query(
      `UPDATE bms_channel_inbound_jobs
          SET status='PROCESSING',attempts=attempts+1,lease_until=now()+($3::int*interval '1 millisecond'),
              last_error_code=NULL
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, row.id, LEASE_MS],
    );
    await client.query("COMMIT");
    if (expired.rowCount) await reportExpiredJobs(tenantId);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      channel: row.channel,
      eventId: row.external_event_id,
      externalAccountId: row.external_account_id,
      customerRef: row.customer_ref,
      messageText: row.message_text,
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      attempts: Number(row.attempts) + 1,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function reportExpiredJobs(tenantId: string) {
  await reportBmsFailure({ tenantId, code: "channel.reply_failed", surface: "customer",
    error: "META_INBOUND_UNKNOWN_OUTCOME_REQUIRES_REVIEW" });
}

async function completeJob(job: MetaInboundJob): Promise<void> {
  await updateJob(job, "SUCCEEDED", null, null);
}

async function failJob(job: MetaInboundJob, error: unknown): Promise<void> {
  const code = error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)
    ? error.message
    : "META_INBOUND_PROCESSING_FAILED";
  // processMetaInboundJob is entered only after effects_started_at is stamped. Never replay an
  // unknown outcome that could have committed a business write.
  await updateJob(job, "DEAD", code, null);
}

async function updateJob(
  job: MetaInboundJob,
  status: "SUCCEEDED" | "FAILED" | "DEAD",
  errorCode: string | null,
  retrySeconds: number | null,
): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, job.tenantId);
    await client.query(
      `UPDATE bms_channel_inbound_jobs
          SET status=$3,lease_until=NULL,last_error_code=$4,
              available_at=CASE WHEN $5::int IS NULL THEN available_at ELSE now()+($5::int*interval '1 second') END,
              completed_at=CASE WHEN $3 IN ('SUCCEEDED','DEAD') THEN now() ELSE NULL END
        WHERE tenant_id=$1 AND id=$2 AND status='PROCESSING' AND attempts=$6`,
      [job.tenantId, job.id, status, errorCode, retrySeconds, job.attempts],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function firstAttachment(job: MetaInboundJob): Attachment | null {
  const attachment = job.attachments.find((item) => item?.url);
  if (!attachment?.url) return null;
  const type = (attachment.type ?? "file").toLowerCase();
  return {
    url: attachment.url,
    name: attachment.title ?? `${type || "attachment"} from Meta`,
    mimeType: attachment.mimeType ?? (type === "image" ? "image/jpeg" : null),
  };
}

export async function processMetaInboundJob(job: MetaInboundJob): Promise<void> {
  const cfg = await getChannel(job.tenantId, job.channel);
  if (!cfg?.active || cfg.external_account_id !== job.externalAccountId) {
    throw new Error("META_CHANNEL_DISABLED_OR_REBOUND");
  }
  const effectsClient = await getClient();
  try {
    await beginTenantTx(effectsClient, job.tenantId);
    const claimed = await effectsClient.query(
      `UPDATE bms_channel_inbound_jobs SET effects_started_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='PROCESSING' AND attempts=$3
          AND lease_until>now() AND effects_started_at IS NULL`,
      [job.tenantId, job.id, job.attempts],
    );
    if (claimed.rowCount !== 1) throw new Error("META_INBOUND_LEASE_LOST");
    await effectsClient.query("COMMIT");
  } catch (error) {
    await effectsClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    effectsClient.release();
  }
  const attachment = firstAttachment(job);
  if (!job.messageText) {
    await logInboundMessage(job.tenantId, job.channel, job.customerRef, {
      body: "",
      attachment,
      meta: {
        type: job.attachments[0]?.type ?? "attachment",
        providerMessageId: job.eventId,
        unsupportedForAi: true,
        raw: { attachmentCount: job.attachments.length },
      },
    });
    await recordInboundEvent(job.tenantId, job.channel);
    return;
  }

  let result: Pick<Awaited<ReturnType<typeof runPipeline>>, "reply" | "quality">;
  try {
    result = await runPipeline(job.messageText, job.channel, job.tenantId, job.customerRef);
  } catch (error) {
    const fallbackReply = "ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งในสักครู่นะคะ 🙏";
    await reportBmsFailure({
      tenantId: job.tenantId,
      code: "channel.reply_failed",
      error,
      surface: "customer",
      channel: job.channel,
      customerRef: job.customerRef,
      meta: { eventId: job.eventId },
    });
    result = { reply: fallbackReply, quality: fallbackEvidenceQuality(error, fallbackReply) };
  }

  await logConversation(
    job.tenantId,
    job.channel,
    job.customerRef,
    job.messageText,
    result.reply,
    result.quality,
    attachment,
    attachment ? {
      type: job.attachments[0]?.type ?? "attachment",
      providerMessageId: job.eventId,
      raw: { attachmentCount: job.attachments.length },
    } : null,
  );
  const delivered = await deliverToChannel(job.tenantId, job.channel, job.customerRef, result.reply);
  if (!delivered) {
    await reportBmsFailure({
      tenantId: job.tenantId,
      code: "channel.push_failed",
      error: "Meta reply delivery failed",
      surface: "customer",
      channel: job.channel,
      customerRef: job.customerRef,
      meta: { eventId: job.eventId },
    });
    throw new Error("META_REPLY_DELIVERY_FAILED");
  }
  await recordInboundEvent(job.tenantId, job.channel);
}

/**
 * Process bounded work. A tenant hint gives a just-arrived webhook low latency; the cron worker
 * omits it and recovers every tenant's expired leases/failed jobs.
 */
export async function runMetaInboundBatch(
  limit = 25,
  tenantHint?: string,
): Promise<{ processed: number; failed: number; deadLettered: number }> {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25;
  const tenantRows = tenantHint
    ? [{ tenant_id: tenantHint }]
    : (await query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM bms_channel_inbound_jobs
        WHERE available_at<=now()
          AND (status IN ('PENDING','FAILED') OR (status='PROCESSING' AND lease_until<now()))
        ORDER BY tenant_id LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    )).rows;

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const tenant of tenantRows) {
    while (processed + failed + deadLettered < limit) {
      const job = await claimForTenant(tenant.tenant_id);
      if (!job) break;
      try {
        await processMetaInboundJob(job);
        await completeJob(job);
        processed += 1;
      } catch (error) {
        if (error instanceof Error && error.message === "META_INBOUND_LEASE_LOST") {
          failed += 1;
          continue;
        }
        await failJob(job, error);
        await reportBmsFailure({ tenantId: job.tenantId, code: "channel.reply_failed",
          surface: "customer", channel: job.channel, error: "META_INBOUND_REQUIRES_REVIEW" });
        deadLettered += 1;
      }
    }
  }
  return { processed, failed, deadLettered };
}
