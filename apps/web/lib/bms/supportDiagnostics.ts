import "server-only";

import crypto from "crypto";
import { gzip } from "zlib";
import { promisify } from "util";
import { getClient, query } from "@/lib/db";
import { deleteStoredFile, persistBuffer, readStoredFile } from "@/lib/storage";
import { sendEmail } from "@/lib/mailer";
import { beginTenantTx } from "./tenant";
import { isAllowedPosDiagnosticAction, safePosDiagnosticErrorCode,
  safePosDiagnosticReason, safePosDiagnosticRoute } from "@pos-core/diagnosticOperations";

const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_SOURCE = 20_000;
const MAX_INGEST_BATCH = 100;
const gzipAsync = promisify(gzip);
const ALLOWED_CONTEXT_KEYS = new Set([
  "cashierUserId",
  "route", "previousRoute", "online", "errorName",
  "errorCode", "httpStatus", "durationMs", "appVersion", "platform",
  "source", "previousState", "nextState",
  "outcome", "nativeCode", "serverResponded", "droppedCount", "gapFrom", "gapTo", "gapReason",
]);
const POS_CONTEXT_KEYS = new Set([
  "cashierUserId", "route", "online", "errorCode", "httpStatus", "durationMs",
  "appVersion", "platform", "source", "previousState", "nextState", "outcome",
  "nativeCode", "serverResponded", "droppedCount", "gapFrom", "gapTo", "gapReason",
]);
const SUPPORT_CATEGORIES = new Set(["pos", "navigation", "network", "ui", "support"]);
const BROWSER_ACTIONS = new Set(["ui.route_view", "network.online", "network.offline",
  "ui.window_error", "ui.unhandled_rejection", "support.bundle_send_confirmed",
  "support.activity_gap", "support.unknown_event"]);

export type SupportIngestResult = {
  accepted: number;
  duplicate: number;
  rejected: number;
  results: Array<{ index: number; eventId: string | null; status: "accepted" | "duplicate" | "rejected"; reason?: string }>;
};

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

export type PosDeviceDiagnosticEvent = {
  id: string;
  occurredAt: string;
  receivedAt: string;
  correlationId: string | null;
  actorKind: "cashier" | "user" | "device" | "unknown";
  actorLabel: string | null;
  actorRole: string | null;
  deviceId: string | null;
  locationId: string | null;
  actorId: string | null;
  category: string;
  action: string;
  status: string | null;
  message: string | null;
  context: Record<string, unknown>;
};

function bounded(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function safeUuid(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function safeActivityActor(value: unknown): string | null {
  return typeof value === "string" && (safeUuid(value)
    || /^[0-9]{1,18}$/.test(value)
    || /^pos:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    ? value : null;
}

function safeOccurredAt(value: unknown): { value: string | null; reason?: string } {
  const parsed = new Date(String(value ?? ""));
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime())) return { value: null, reason: "invalid_time" };
  if (parsed.getTime() < now - MAX_RANGE_MS) return { value: null, reason: "event_too_old" };
  if (parsed.getTime() > now + 5 * 60_000) return { value: null, reason: "clock_ahead" };
  return { value: parsed.toISOString() };
}

const SECRET_KEY = /(authorization|cookie|token|secret|password|passcode|pin|api[_-]?key|card|account|raw|payload|request|response|body|note|address|phone)/i;
const SECRET_TEXT = /(Bearer\s+[A-Za-z0-9._~+\/-]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

function safeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.replace(SECRET_TEXT, "[REDACTED]").slice(0, 500);
  // node-postgres returns timestamptz columns as Date objects. Treating every object as a
  // plain record turns a Date into `{}` because it has no enumerable properties, which removes
  // the one field Support needs to order and correlate an outage timeline.
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
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
    else if (typeof raw === "number" && Number.isFinite(raw) && (
      key === "httpStatus" ? Number.isInteger(raw) && raw >= 100 && raw <= 599
      : key === "durationMs" ? raw >= 0 && raw <= 120_000
      : key === "droppedCount" ? Number.isInteger(raw) && raw > 0 && raw <= 1_000_000
      : false)) output[key] = raw;
    else if (typeof raw === "string") {
      // Context is diagnostic metadata, never a free-text escape hatch for URLs, headers or PII.
      const safe = raw.slice(0, 120);
      if (["route", "previousRoute"].includes(key)) {
        const route = safePosDiagnosticRoute(raw)
          ?? (["/admin", "/admin/support-diagnostics", "/admin/pos-devices"].includes(raw) ? raw : null);
        if (route) output[key] = route;
      }
      else if (key === "errorCode") output[key] = safePosDiagnosticErrorCode(raw);
      else if (key === "nativeCode" && /^(?:-?[0-9]{1,4}|ERR_[A-Z_]{1,60})$/.test(safe)) output[key] = safe;
      else if (["previousState", "nextState"].includes(key) && /^(?:unchecked|checking|online|offline|degraded|reconnecting|authentication_required)$/.test(safe)) output[key] = safe;
      else if (key === "outcome" && /^(?:unknown|rejected|read_failed)$/.test(safe)) output[key] = safe;
      else if (key === "source" && /^(?:native-pos|desktop-pos|restaurant-pos|browser-pos|admin)$/.test(safe)) output[key] = safe;
      else if (key === "platform" && /^(?:windows|win32|linux|darwin|android|ios|browser|web)$/.test(safe)) output[key] = safe;
      else if (key === "appVersion" && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9][A-Za-z0-9.\-]{0,60})?$/.test(safe)) output[key] = safe;
      else if (["gapFrom", "gapTo"].includes(key) && Number.isFinite(Date.parse(safe))) output[key] = new Date(safe).toISOString();
      else if (key === "gapReason" && safePosDiagnosticReason(safe)) output[key] = safe;
      else if (key === "errorName" && /^(?:Error|TypeError|AbortError|TimeoutError|NetworkError|FetchError|SyntaxError|ApolloError)$/.test(safe)) output[key] = safe;
    }
  }
  return output;
}

function safePosContext(value: unknown): Record<string, unknown> {
  const output = Object.fromEntries(Object.entries(safeContext(value)).filter(([key]) => POS_CONTEXT_KEYS.has(key)));
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>) : {};
  if (raw.errorCode != null) output.errorCode = safePosDiagnosticErrorCode(raw.errorCode);
  if (typeof output.nativeCode === "string" && !/^-?\d{1,4}$/.test(output.nativeCode)) delete output.nativeCode;
  return output;
}

/** Re-validate stored rows as well as new uploads: older deployments accepted free text. */
function safeStoredActivity(row: Record<string, unknown>): Record<string, unknown> {
  const category = typeof row.category === "string" && SUPPORT_CATEGORIES.has(row.category)
    ? row.category : "support";
  const action = category === "pos"
    ? (isAllowedPosDiagnosticAction(row.action) ? row.action : "pos.unknown_operation")
    : (typeof row.action === "string" && BROWSER_ACTIONS.has(row.action)
      ? row.action : "support.unknown_event");
  return {
    client_event_id: safeUuid(row.client_event_id),
    occurred_at: row.occurred_at,
    received_at: row.received_at,
    actor_id: safeActivityActor(row.actor_id),
    location_id: safeUuid(row.location_id),
    device_id: safeUuid(row.device_id),
    session_id: safeUuid(row.session_id),
    correlation_id: safeUuid(row.correlation_id),
    category,
    action,
    status: typeof row.status === "string" && ["success", "error", "warning", "info"].includes(row.status)
      ? row.status : null,
    message: null,
    context: category === "pos" ? safePosContext(row.context) : safeContext(row.context),
  };
}

function safeStoredAudit(row: Record<string, unknown>) {
  return { created_at: row.created_at, actor: safeActivityActor(row.actor),
    action: typeof row.action === "string" && /^(?:pos|support)\.[a-z][a-z0-9_.-]{0,79}$/.test(row.action)
      ? row.action : "other" };
}

function safeStoredIncident(row: Record<string, unknown>) {
  return { created_at: row.created_at,
    tier: ["A", "B"].includes(String(row.tier)) ? row.tier : null,
    // Historical error_message/meta fields were free text and cannot safely enter exports.
    code: "redacted" };
}

function safeStoredSystemLog(row: Record<string, unknown>) {
  return { created_at: row.created_at,
    level: ["error", "warn", "warning", "info", "debug"].includes(String(row.level)) ? row.level : null,
    status: ["error", "success", "warning", "info"].includes(String(row.status)) ? row.status : null,
    correlation_id: safeUuid(row.correlation_id),
    route_name: safePosDiagnosticRoute(row.route_name),
    duration_ms: typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms)
      && row.duration_ms >= 0 && row.duration_ms <= 120_000 ? row.duration_ms : null };
}

export async function recordSupportEventsDetailed(input: {
  tenantId: string;
  actorId: string;
  events: SupportEventInput[];
}): Promise<SupportIngestResult> {
  const events = input.events.slice(0, MAX_INGEST_BATCH);
  const outcome: SupportIngestResult = { accepted: 0, duplicate: 0, rejected: 0, results: [] };
  for (let index = events.length; index < input.events.length; index += 1) {
    outcome.rejected += 1;
    outcome.results.push({ index, eventId: safeUuid(input.events[index]?.eventId), status: "rejected", reason: "batch_limit" });
  }
  if (!events.length) return outcome;
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const locationIds = [...new Set(events.map((event) => safeUuid(event?.locationId)).filter((id): id is string => Boolean(id)))];
    const deviceIds = [...new Set(events.map((event) => safeUuid(event?.deviceId)).filter((id): id is string => Boolean(id)))];
    const cashierUserIds = [...new Set(events
      .map((event) => safeUuid(event?.context?.cashierUserId))
      .filter((id): id is string => Boolean(id)))];
    const validLocations = locationIds.length
      ? await client.query<{ id: string }>(`SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [input.tenantId, locationIds])
      : { rows: [] as Array<{ id: string }> };
    const validDevices = deviceIds.length
      ? await client.query<{ id: string }>(`SELECT id FROM bms_pos_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [input.tenantId, deviceIds])
      : { rows: [] as Array<{ id: string }> };
    const validCashiers = cashierUserIds.length
      ? await client.query<{ id: string }>(`SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [input.tenantId, cashierUserIds])
      : { rows: [] as Array<{ id: string }> };
    const allowedLocations = new Set(validLocations.rows.map((row) => String(row.id)));
    const allowedDevices = new Set(validDevices.rows.map((row) => String(row.id)));
    const allowedCashiers = new Set(validCashiers.rows.map((row) => String(row.id)));
    for (const [index, event] of events.entries()) {
      const eventId = safeUuid(event?.eventId);
      const occurredAt = safeOccurredAt(event?.occurredAt);
      const locationId = safeUuid(event?.locationId);
      const deviceId = safeUuid(event?.deviceId);
      const reject = (reason: string) => {
        outcome.rejected += 1;
        outcome.results.push({ index, eventId, status: "rejected", reason });
      };
      if (!event || typeof event !== "object" || Array.isArray(event)) { reject("invalid_event"); continue; }
      if (!eventId) { reject("invalid_event_id"); continue; }
      if (!occurredAt.value) { reject(occurredAt.reason ?? "invalid_time"); continue; }
      if (event.locationId != null && (!locationId || !allowedLocations.has(locationId))) { reject("invalid_location"); continue; }
      if (event.deviceId != null && (!deviceId || !allowedDevices.has(deviceId))) { reject("invalid_device"); continue; }
      const category = bounded(event.category, 60) ?? "ui";
      const action = bounded(event.action, 120);
      if (!SUPPORT_CATEGORIES.has(category)) { reject("invalid_category"); continue; }
      if (!action || !/^[a-z][A-Za-z0-9_.-]{0,119}$/.test(action)) { reject("invalid_action"); continue; }
      if (category === "pos" && !isAllowedPosDiagnosticAction(action)) {
        reject("invalid_action"); continue;
      }
      if (category !== "pos" && !BROWSER_ACTIONS.has(action)) { reject("invalid_action"); continue; }
      if (!["success", "error", "warning", "info"].includes(event.status ?? "")) {
        reject("invalid_status"); continue;
      }
      const context = category === "pos" ? safePosContext(event.context) : safeContext(event.context);
      const cashierUserId = safeUuid(context.cashierUserId);
      if (!cashierUserId || !allowedCashiers.has(cashierUserId)) delete context.cashierUserId;
      const correlationId = safeUuid(event.correlationId);
      if (event.correlationId != null && !correlationId) { reject("invalid_correlation_id"); continue; }
      const result = await client.query(
        `INSERT INTO bms_support_events
           (tenant_id, client_event_id, occurred_at, actor_id, location_id, device_id, session_id,
            correlation_id, category, action, status, message, context)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT (tenant_id, client_event_id) DO NOTHING`,
        [input.tenantId, eventId, occurredAt.value, input.actorId,
          locationId, deviceId, safeUuid(event.sessionId),
          correlationId, category, action, bounded(event.status, 40),
          null, JSON.stringify(context)]
      );
      const status = result.rowCount ? "accepted" : "duplicate";
      outcome[status] += 1;
      outcome.results.push({ index, eventId, status });
    }
    await client.query("COMMIT");
    outcome.results.sort((left, right) => left.index - right.index);
    return outcome;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** Compatibility for browser/admin activity callers that only need the inserted count. */
export async function recordSupportEvents(input: Parameters<typeof recordSupportEventsDetailed>[0]): Promise<number> {
  return (await recordSupportEventsDetailed(input)).accepted;
}

export type PosDeviceDiagnosticPage = { events: PosDeviceDiagnosticEvent[]; nextCursor: string | null };

export async function listPosDeviceDiagnosticPage(input: {
  tenantId: string;
  deviceId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  errorCode?: string | null;
  correlationId?: string | null;
  cursor?: string | null;
  limit?: number | null;
}): Promise<PosDeviceDiagnosticPage> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50) || 50));
  const deviceId = input.deviceId ? safeUuid(input.deviceId) : null;
  if (input.deviceId && !deviceId) throw new SupportDiagnosticsInputError("invalid deviceId");
  const correlationId = input.correlationId ? safeUuid(input.correlationId) : null;
  if (input.correlationId && !correlationId) throw new SupportDiagnosticsInputError("invalid correlationId");
  const status = input.status || null;
  if (status && !["error", "warning", "success", "info"].includes(status)) throw new SupportDiagnosticsInputError("invalid status");
  const errorCode = input.errorCode?.trim().toUpperCase() || null;
  if (errorCode && !/^[A-Z][A-Z0-9_]{0,59}$/.test(errorCode)) throw new SupportDiagnosticsInputError("invalid errorCode");
  const parseTime = (value: string | null | undefined) => {
    if (!value) return null;
    const time = new Date(value);
    if (!Number.isFinite(time.getTime())) throw new SupportDiagnosticsInputError("invalid time filter");
    return time.toISOString();
  };
  const from = parseTime(input.from);
  const to = parseTime(input.to);
  if (from && to && from > to) throw new SupportDiagnosticsInputError("invalid time range");
  let cursorTime: string | null = null;
  let cursorId: string | null = null;
  if (input.cursor) {
    try {
      const [time, id, extra] = Buffer.from(input.cursor, "base64url").toString("utf8").split("|");
      if (extra || !/^\d{1,20}$/.test(id) || !Number.isFinite(Date.parse(time))) throw new Error("cursor");
      cursorTime = new Date(time).toISOString();
      cursorId = id;
    } catch { throw new SupportDiagnosticsInputError("invalid cursor"); }
  }
  const client = await getClient();
  let result;
  try {
    await beginTenantTx(client, input.tenantId);
    result = await client.query<any>(
    `SELECT e.id, e.occurred_at, e.received_at, e.correlation_id, e.device_id, e.location_id, e.actor_id,
            e.category, e.action, e.status, NULL::text AS message, e.context,
            CASE
              WHEN e.context->>'cashierUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN 'cashier'
              WHEN e.actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN 'user'
              WHEN e.actor_id LIKE 'pos:%' THEN 'device'
              ELSE 'unknown'
            END AS actor_kind,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.email, '')) AS actor_label,
            r.name AS actor_role
       FROM bms_support_events e
       LEFT JOIN users u
         ON u.tenant_id = e.tenant_id
        AND u.id = CASE
          WHEN e.context->>'cashierUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (e.context->>'cashierUserId')::uuid
          WHEN e.actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN e.actor_id::uuid
          ELSE NULL
        END
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE e.tenant_id = $1
        AND e.category = 'pos'
        AND ($2::uuid IS NULL OR e.device_id = $2::uuid)
        AND ($3::timestamptz IS NULL OR e.occurred_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR e.occurred_at <= $4::timestamptz)
        AND ($5::text IS NULL OR e.status = $5::text)
        AND ($6::text IS NULL OR e.context->>'errorCode' = $6::text)
        AND ($7::text IS NULL OR e.correlation_id = $7::text)
        AND ($8::timestamptz IS NULL OR (e.occurred_at, e.id) < ($8::timestamptz, $9::bigint))
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT $10`,
    [input.tenantId, deviceId, from, to, status, errorCode, correlationId, cursorTime, cursorId, safeLimit + 1]
  );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
  const rows = result.rows.slice(0, safeLimit);
  const events = rows.map((row) => {
    const context = safePosContext(row.context);
    delete context.cashierUserId;
    return {
      id: String(row.id),
      occurredAt: row.occurred_at?.toISOString?.() ?? row.occurred_at,
      receivedAt: row.received_at?.toISOString?.() ?? row.received_at,
      correlationId: row.correlation_id ?? null,
      actorKind: row.actor_kind ?? "unknown",
      actorLabel: row.actor_label ?? null,
      actorRole: row.actor_role ?? null,
      deviceId: row.device_id ?? null,
      locationId: row.location_id ?? null,
      actorId: row.actor_id ?? null,
      category: row.category,
      action: isAllowedPosDiagnosticAction(row.action) ? row.action : "pos.unknown_operation",
      status: row.status ?? null,
      message: row.message ?? null,
      context,
    };
  });
  // The extra row only proves there is another page. Cursor must point at the
  // last row returned to the caller, or the first row of the next page is lost.
  const last = rows.at(-1);
  return {
    events,
    nextCursor: result.rows.length > safeLimit && last
      ? Buffer.from(`${new Date(last.occurred_at).toISOString()}|${last.id}`, "utf8").toString("base64url")
      : null,
  };
}

/** Keep the original GraphQL field for older clients. */
export async function listPosDeviceDiagnosticEvents(input: { tenantId: string; deviceId?: string | null; limit?: number | null }) {
  return (await listPosDeviceDiagnosticPage(input)).events;
}

/**
 * A caller-supplied range that cannot be honoured. Separated from ordinary failures so a
 * mistyped `from`/`to` answers 400 instead of falling through withRouteErrorLog as a 500 —
 * a client-triggerable 500 writes an error-level system log and can page ops for what is
 * really just bad input.
 */
export class SupportDiagnosticsInputError extends Error {}

function normalizeRange(fromRaw: unknown, toRaw: unknown) {
  const toCandidate = new Date(String(toRaw ?? ""));
  const now = new Date();
  const to = Number.isFinite(toCandidate.getTime()) && toCandidate.getTime() <= now.getTime() + 5 * 60_000
    ? toCandidate
    : now;
  const fromCandidate = new Date(String(fromRaw ?? ""));
  const fallback = new Date(to.getTime() - 60 * 60 * 1000);
  let from = Number.isFinite(fromCandidate.getTime()) ? fromCandidate : fallback;
  if (from > to) throw new SupportDiagnosticsInputError("ช่วงเวลา diagnostics ไม่ถูกต้อง (from อยู่หลัง to)");
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
                correlation_id, category, action, status, NULL::text AS message, context
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
      ...events.map((data: any) => ({ kind: "activity", at: data.occurred_at,
        data: safeStoredActivity(data) })),
      ...audit.map((data: any) => ({ kind: "audit", at: data.created_at, data: safeStoredAudit(data) })),
      ...incidents.map((data: any) => ({ kind: "failure_incident", at: data.created_at, data: safeStoredIncident(data) })),
      ...system.map((data: any) => ({ kind: "system_log", at: data.created_at, data: safeStoredSystemLog(data) })),
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
  // The bundle/file lookup deliberately runs on the plain pool, NOT inside
  // beginTenantTx: 9.28 revoked SELECT on `files` from bms_app on purpose (files has
  // RLS disabled, so that grant let the constrained role read every shop's file rows).
  // Joining `files` under SET LOCAL ROLE bms_app fails with
  // "permission denied for table files", which would break every Support download.
  // Tenant scope is still explicit here, and the download is audited below before any
  // bytes are handed back.
  const meta = await query<{
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
  const row = meta.rows[0];
  if (!row) return null;

  // Read first, then audit: an audit row for a download that never produced bytes is a
  // lie, and a failed audit must stop the download rather than leave it unrecorded.
  const buffer = await readStoredFile(row.relpath);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'support.logs_download',$3,$4::jsonb)`,
      [input.tenantId, input.actorId, input.bundleId, JSON.stringify({ checksum: row.checksum })]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  return {
    buffer,
    checksum: row.checksum,
    filename: row.original_name || `support-diagnostics-${row.id}.ndjson.gz`,
  };
}
