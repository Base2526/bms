import "server-only";

import crypto from "crypto";
import { gzip } from "zlib";
import { promisify } from "util";
import { getClient, query } from "@/lib/db";
import { deleteStoredFile, persistBuffer, readStoredFile } from "@/lib/storage";
import { sendEmail } from "@/lib/mailer";
import { beginTenantTx } from "./tenant";

const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_SOURCE = 20_000;
const MAX_INGEST_BATCH = 100;
const gzipAsync = promisify(gzip);
const ALLOWED_CONTEXT_KEYS = new Set([
  "route", "previousRoute", "online", "visibility", "digest", "errorName",
  "errorCode", "httpStatus", "durationMs", "appVersion", "platform", "viewport",
  "source", "retry", "sequence", "bundleVersion",
]);

export type SupportEventInput = {
  eventId?: string;
  occurredAt?: string;
  locationId?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  category?: string;
  action?: string;
  status?: string | null;
  message?: string | null;
  context?: Record<string, unknown> | null;
};

function bounded(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function safeUuid(value: unknown): string | null {
  const text = bounded(value, 36);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function safeOccurredAt(value: unknown): string | null {
  const parsed = new Date(String(value ?? ""));
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime())) return null;
  if (parsed.getTime() < now - MAX_RANGE_MS) return null;
  if (parsed.getTime() > now + 5 * 60_000) return new Date(now).toISOString();
  return parsed.toISOString();
}

const SECRET_KEY = /(authorization|cookie|token|secret|password|passcode|pin|api[_-]?key|card|account|raw|payload|request|response|body|note|address|phone)/i;
const SECRET_TEXT = /(Bearer\s+[A-Za-z0-9._~+\/-]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

function safeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.replace(SECRET_TEXT, "[REDACTED]").slice(0, 500);
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeDiagnosticValue(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 100);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : safeDiagnosticValue(item, depth + 1);
  }
  return output;
}

function safeContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (typeof raw === "boolean") output[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) output[key] = raw;
    else if (typeof raw === "string") output[key] = raw.slice(0, 300);
  }
  return output;
}

export async function recordSupportEvents(input: {
  tenantId: string;
  actorId: string;
  events: SupportEventInput[];
}): Promise<number> {
  const events = input.events.slice(0, MAX_INGEST_BATCH);
  if (!events.length) return 0;
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const locationIds = [...new Set(events.map((event) => safeUuid(event.locationId)).filter((id): id is string => Boolean(id)))];
    const deviceIds = [...new Set(events.map((event) => safeUuid(event.deviceId)).filter((id): id is string => Boolean(id)))];
    const validLocations = locationIds.length
      ? await client.query<{ id: string }>(`SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [input.tenantId, locationIds])
      : { rows: [] as Array<{ id: string }> };
    const validDevices = deviceIds.length
      ? await client.query<{ id: string }>(`SELECT id FROM bms_pos_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [input.tenantId, deviceIds])
      : { rows: [] as Array<{ id: string }> };
    const allowedLocations = new Set(validLocations.rows.map((row) => String(row.id)));
    const allowedDevices = new Set(validDevices.rows.map((row) => String(row.id)));
    let inserted = 0;
    for (const event of events) {
      const eventId = safeUuid(event.eventId);
      const occurredAt = safeOccurredAt(event.occurredAt);
      const locationId = safeUuid(event.locationId);
      const deviceId = safeUuid(event.deviceId);
      if (!eventId || !occurredAt) continue;
      if (event.locationId != null && (!locationId || !allowedLocations.has(locationId))) continue;
      if (event.deviceId != null && (!deviceId || !allowedDevices.has(deviceId))) continue;
      const category = bounded(event.category, 60) ?? "ui";
      const action = bounded(event.action, 120);
      if (!action) continue;
      const result = await client.query(
        `INSERT INTO bms_support_events
           (tenant_id, client_event_id, occurred_at, actor_id, location_id, device_id, session_id,
            correlation_id, category, action, status, message, context)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12::jsonb)
         ON CONFLICT (tenant_id, client_event_id) DO NOTHING`,
        [input.tenantId, eventId, occurredAt, input.actorId,
          locationId, deviceId, bounded(event.sessionId, 120),
          bounded(event.correlationId, 120), category, action, bounded(event.status, 40),
          JSON.stringify(safeContext(event.context))]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function normalizeRange(fromRaw: unknown, toRaw: unknown) {
  const toCandidate = new Date(String(toRaw ?? ""));
  const now = new Date();
  const to = Number.isFinite(toCandidate.getTime()) && toCandidate.getTime() <= now.getTime() + 5 * 60_000
    ? toCandidate
    : now;
  const fromCandidate = new Date(String(fromRaw ?? ""));
  const fallback = new Date(to.getTime() - 60 * 60 * 1000);
  let from = Number.isFinite(fromCandidate.getTime()) ? fromCandidate : fallback;
  if (from > to) throw new Error("ช่วงเวลา diagnostics ไม่ถูกต้อง");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    from = new Date(to.getTime() - MAX_RANGE_MS);
  }
  return { from, to };
}

export async function buildSupportBundle(input: {
  tenantId: string;
  actorId: string;
  from?: string | null;
  to?: string | null;
}) {
  const range = normalizeRange(input.from, input.to);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const queryLimit = MAX_EVENTS_PER_SOURCE + 1;
    const eventsResult = await client.query(
        `SELECT client_event_id, occurred_at, received_at, actor_id, location_id, device_id, session_id,
                correlation_id, category, action, status, message, context
           FROM bms_support_events
          WHERE tenant_id = $1 AND occurred_at BETWEEN $2 AND $3
          ORDER BY occurred_at DESC, id DESC LIMIT $4`,
        [input.tenantId, range.from, range.to, queryLimit]
      );
    const auditResult = await client.query(
        `SELECT created_at, actor, action, target, meta
           FROM bms_audit_log
          WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
          ORDER BY created_at DESC, id DESC LIMIT $4`,
        [input.tenantId, range.from, range.to, queryLimit]
      );
    const incidentsResult = await client.query(
        `SELECT created_at, code, tier, surface, channel, conversation_id,
                error_message, meta, notified_shop_at, notified_platform_at
           FROM bms_failure_incidents
          WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
          ORDER BY created_at DESC, id DESC LIMIT $4`,
        [input.tenantId, range.from, range.to, queryLimit]
      );
    const systemResult = await client.query(
        `SELECT created_at, level, category, message, action, status, correlation_id,
                session_id, route_name, platform, app_version, duration_ms, error_message
           FROM system_logs
          WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
          ORDER BY created_at DESC, id DESC LIMIT $4`,
        [input.tenantId, range.from, range.to, queryLimit]
      );
    await client.query("COMMIT");

    const events = eventsResult.rows.slice(0, MAX_EVENTS_PER_SOURCE).reverse();
    const audit = auditResult.rows.slice(0, MAX_EVENTS_PER_SOURCE).reverse();
    const incidents = incidentsResult.rows.slice(0, MAX_EVENTS_PER_SOURCE).reverse();
    const system = systemResult.rows.slice(0, MAX_EVENTS_PER_SOURCE).reverse();

    const counts = {
      activity: events.length,
      audit: audit.length,
      incidents: incidents.length,
      system: system.length,
    };
    const truncated = {
      activity: eventsResult.rows.length > MAX_EVENTS_PER_SOURCE,
      audit: auditResult.rows.length > MAX_EVENTS_PER_SOURCE,
      incidents: incidentsResult.rows.length > MAX_EVENTS_PER_SOURCE,
      system: systemResult.rows.length > MAX_EVENTS_PER_SOURCE,
    };
    const manifest = {
      bundleVersion: 1,
      generatedAt: new Date().toISOString(),
      tenantId: input.tenantId,
      rangeFrom: range.from.toISOString(),
      rangeTo: range.to.toISOString(),
      timezone: "Asia/Bangkok",
      appVersion: process.env.npm_package_version ?? null,
      diagnosticsSchemaVersion: "9.46",
      counts,
      truncated,
      maxRecordsPerSource: MAX_EVENTS_PER_SOURCE,
      privacy: "allowlisted-context; no request bodies, credentials, PINs or tokens",
    };
    const timeline = [
      ...events.map((data: any) => ({ kind: "activity", at: data.occurred_at, data })),
      ...audit.map((data: any) => ({ kind: "audit", at: data.created_at, data })),
      ...incidents.map((data: any) => ({ kind: "failure_incident", at: data.created_at, data })),
      ...system.map((data: any) => ({ kind: "system_log", at: data.created_at, data })),
    ].sort((left, right) => {
      const byTime = new Date(left.at).getTime() - new Date(right.at).getTime();
      return byTime || left.kind.localeCompare(right.kind);
    });
    const content = [
      JSON.stringify({ kind: "manifest", data: manifest }),
      ...timeline.map(({ kind, data }) => JSON.stringify({ kind, data: safeDiagnosticValue(data) })),
    ].filter(Boolean).join("\n") + "\n";
    const buffer = await gzipAsync(Buffer.from(content, "utf8"), { level: 9 });
    return {
      buffer,
      checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
      eventCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
      range,
      manifest,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function recordSupportBundleExport(input: {
  tenantId: string;
  actorId: string;
  bundle: Awaited<ReturnType<typeof buildSupportBundle>>;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const row = await client.query<{ id: string }>(
      `INSERT INTO bms_support_bundles
         (tenant_id, requested_by, status, range_from, range_to, event_count, size_bytes, checksum)
       VALUES ($1,$2,'EXPORTED',$3,$4,$5,$6,$7) RETURNING id`,
      [input.tenantId, input.actorId, input.bundle.range.from, input.bundle.range.to,
        input.bundle.eventCount, input.bundle.buffer.length, input.bundle.checksum]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'support.logs_export',$3,$4::jsonb)`,
      [input.tenantId, input.actorId, row.rows[0].id,
        JSON.stringify({ eventCount: input.bundle.eventCount, checksum: input.bundle.checksum })]
    );
    await client.query("COMMIT");
    return row.rows[0].id;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function sendSupportBundle(input: {
  tenantId: string;
  actorId: string;
  actorEmail: string;
  description: string;
  from?: string | null;
  to?: string | null;
}) {
  const bundle = await buildSupportBundle(input);
  const filename = `support-diagnostics-${Date.now()}.ndjson.gz`;
  const stored = await persistBuffer(bundle.buffer, filename, "application/gzip", "private", input.tenantId);
  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    client = await getClient();
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const bundleRow = await client.query<{ id: string }>(
      `INSERT INTO bms_support_bundles
         (tenant_id, requested_by, status, range_from, range_to, description,
          file_id, event_count, size_bytes, checksum)
       VALUES ($1,$2,'SENT',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.tenantId, input.actorId, bundle.range.from, bundle.range.to,
        input.description.slice(0, 2000), stored.id, bundle.eventCount,
        bundle.buffer.length, bundle.checksum]
    );
    const ticketCode = `SUP-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const ticket = await client.query<{ id: string }>(
      `INSERT INTO support_tickets
         (ticket_id, email, topic, subject, message, ref, tenant_id, diagnostic_bundle_id)
       VALUES ($1,$2,'diagnostics',$3,$4,$5,$6,$7) RETURNING id`,
      [ticketCode, input.actorEmail, `Diagnostics ${ticketCode}`, input.description.slice(0, 5000),
        bundleRow.rows[0].id, input.tenantId, bundleRow.rows[0].id]
    );
    await client.query(
      `UPDATE bms_support_bundles SET support_ticket_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, bundleRow.rows[0].id, ticket.rows[0].id]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'support.logs_send',$3,$4::jsonb)`,
      [input.tenantId, input.actorId, bundleRow.rows[0].id,
        JSON.stringify({ ticketCode, eventCount: bundle.eventCount, checksum: bundle.checksum, consent: true })]
    );
    await client.query("COMMIT");
    let notificationSent = false;
    const supportEmail = (process.env.NEXT_PUBLIC_SUPPORT_TO_EMAIL ?? "").trim();
    if (supportEmail) {
      try {
        await sendEmail(
          {
            to: supportEmail,
            subject: `[${ticketCode}] Diagnostic bundle received`,
            html: `<h2>New diagnostic support case</h2><p><b>Ticket:</b> ${ticketCode}</p><p><b>Events:</b> ${bundle.eventCount}</p><p>Open the platform Support Tickets page to review and download the private bundle.</p>`,
            text: `New diagnostic support case ${ticketCode}. Events: ${bundle.eventCount}. Open Support Tickets to review the private bundle.`,
          },
          { tenantId: input.tenantId, category: "support", triggeredBy: "supportDiagnostics:send" }
        );
        notificationSent = true;
      } catch (error) {
        console.error("[supportDiagnostics] support notification failed", error);
      }
    }
    return {
      bundleId: bundleRow.rows[0].id,
      ticketCode,
      eventCount: bundle.eventCount,
      truncated: bundle.manifest.truncated,
      notificationSent,
    };
  } catch (error) {
    try { await client?.query("ROLLBACK"); } catch {}
    try {
      await deleteStoredFile(stored.relpath);
      await query(
        `UPDATE files SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [stored.id, input.tenantId]
      );
    } catch (cleanupError) {
      console.error("[supportDiagnostics] orphan bundle cleanup failed", cleanupError);
    }
    throw error;
  } finally { client?.release(); }
}

type ClaimedExpiredBundle = {
  id: string;
  tenant_id: string;
  file_id: number;
  relpath: string | null;
  claimed_at: Date;
};

/**
 * Physically remove expired support bundles. The claim is committed before I/O,
 * so multiple scheduler instances cannot work on the same object concurrently.
 * A stale claim becomes retryable after 15 minutes if a worker crashes.
 */
export async function purgeExpiredSupportBundles(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
  const client = await getClient();
  let claimed: ClaimedExpiredBundle[] = [];
  try {
    await client.query("BEGIN");
    const result = await client.query<ClaimedExpiredBundle>(
      `WITH candidates AS (
         SELECT id
           FROM bms_support_bundles
          WHERE status = 'SENT'
            AND file_id IS NOT NULL
            AND expires_at <= now()
            AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < now() - interval '15 minutes')
          ORDER BY expires_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       ), claimed AS (
         UPDATE bms_support_bundles b
            SET cleanup_claimed_at = now()
           FROM candidates c
          WHERE b.id = c.id
          RETURNING b.id, b.tenant_id, b.file_id, b.cleanup_claimed_at
       )
       SELECT c.id, c.tenant_id, c.file_id, f.relpath, c.cleanup_claimed_at AS claimed_at
         FROM claimed c
         LEFT JOIN files f ON f.id = c.file_id AND f.tenant_id = c.tenant_id`,
      [safeLimit]
    );
    claimed = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  let purged = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      if (row.relpath) await deleteStoredFile(row.relpath);
      const result = await query<{ purged: number }>(
        `WITH updated_bundle AS (
           UPDATE bms_support_bundles
              SET status = 'PURGED', file_id = NULL, purged_at = now(), cleanup_claimed_at = NULL
            WHERE id = $1 AND tenant_id = $2 AND status = 'SENT'
              AND cleanup_claimed_at = $3
            RETURNING id
         ), updated_file AS (
           UPDATE files
              SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
            WHERE id = $4 AND tenant_id = $2 AND EXISTS (SELECT 1 FROM updated_bundle)
            RETURNING id
         )
         SELECT count(*)::int AS purged FROM updated_bundle`,
        [row.id, row.tenant_id, row.claimed_at, row.file_id]
      );
      purged += Number(result.rows[0]?.purged ?? 0);
    } catch (error) {
      failed += 1;
      await query(
        `UPDATE bms_support_bundles SET cleanup_claimed_at = NULL
          WHERE id = $1 AND tenant_id = $2 AND status = 'SENT' AND cleanup_claimed_at = $3`,
        [row.id, row.tenant_id, row.claimed_at]
      ).catch(() => undefined);
      console.error("[supportDiagnostics] expired bundle purge failed", { bundleId: row.id, error });
    }
  }
  return { claimed: claimed.length, purged, failed };
}

export async function readSupportBundleForPlatform(input: {
  tenantId: string;
  bundleId: string;
  actorId: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const result = await client.query<{
      id: string;
      relpath: string;
      original_name: string | null;
      checksum: string;
    }>(
      `SELECT b.id, f.relpath, f.original_name, b.checksum
         FROM bms_support_bundles b
         JOIN files f ON f.id = b.file_id AND f.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.id = $2 AND b.status = 'SENT'
          AND b.expires_at > now()`,
      [input.tenantId, input.bundleId]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const buffer = await readStoredFile(row.relpath);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'support.logs_download',$3,$4::jsonb)`,
      [input.tenantId, input.actorId, input.bundleId, JSON.stringify({ checksum: row.checksum })]
    );
    await client.query("COMMIT");
    return {
      buffer,
      checksum: row.checksum,
      filename: row.original_name || `support-diagnostics-${row.id}.ndjson.gz`,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
