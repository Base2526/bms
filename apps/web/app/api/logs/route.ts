import { NextRequest, NextResponse } from "next/server";
import { getClient, query } from "@/lib/db";
import { verifyUserFromRequest } from "@/lib/auth/server";
import { authorizeAdminRoute, authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";
import { writeLogServer } from "@/lib/log/writeLog.server";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readBoundedWebhookText } from "@/lib/bms/webhookBody";

export const dynamic = "force-dynamic";
const MAX_LOG_BATCH_BYTES = 256 * 1024;
const USER_ID_RE = /^(?:\d{1,10}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const LOG_ID_RE = /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
function validUserId(value: string): boolean {
  return USER_ID_RE.test(value) && (!/^\d+$/.test(value) || Number(value) <= 2_147_483_647);
}

function positiveInt(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= max ? number : null;
}

function validLogDate(value: string): boolean {
  if (isDateOnly(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    validLogDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function isDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

let structuredColsReady: boolean | null = null;
async function ensureStructuredColsReady() {
  if (structuredColsReady !== null) return structuredColsReady;
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='system_logs'
          AND column_name='action'
      ) AS exists`
    );
    structuredColsReady = !!rows?.[0]?.exists;
  } catch {
    structuredColsReady = false;
  }
  return structuredColsReady;
}

function whereEq(hasStructured: boolean, column: string, metaKey: string, paramIdx: number) {
  return hasStructured ? `${column} = $${paramIdx}` : `meta->>'${metaKey}' = $${paramIdx}`;
}

async function deleteLogsWithAudit(sql: string, args: unknown[], actorId: string | number, mode: string) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const deleted = await client.query(sql, args);
    const count = deleted.rowCount ?? 0;
    await client.query(
      `INSERT INTO system_logs(level, category, message, meta)
       VALUES ('warn', 'log-admin', 'System logs deleted', $1::jsonb)`,
      [JSON.stringify({ action: "system_logs.delete", actorId: String(actorId), mode, count })]
    );
    await client.query("COMMIT");
    return count;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// GET /api/logs
// Filters:
//  q, level, category, user_id, action, status, correlation_id, session_id, platform, app_version, date_start, date_end, page, pageSize
async function handleGET(req: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const hasStructured = await ensureStructuredColsReady();

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const level = (searchParams.get("level") || "").trim();
  const category = (searchParams.get("category") || "").trim();
  const user_id = (searchParams.get("user_id") || "").trim();
  const action = (searchParams.get("action") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const correlation_id = (searchParams.get("correlation_id") || "").trim();
  const session_id = (searchParams.get("session_id") || "").trim();
  const platform = (searchParams.get("platform") || "").trim();
  const app_version = (searchParams.get("app_version") || "").trim();
  const date_start = (searchParams.get("date_start") || "").trim();
  const date_end = (searchParams.get("date_end") || "").trim();
  const page = positiveInt(searchParams.get("page") || "1", 100_000);
  const pageSize = positiveInt(searchParams.get("pageSize") || "50", 200);
  if (page === null || pageSize === null ||
      (user_id && !validUserId(user_id)) || q.length > 200 ||
      (date_start && !validLogDate(date_start)) ||
      (date_end && !validLogDate(date_end))) {
    return NextResponse.json({ error: "Invalid log filters" }, { status: 400 });
  }
  const offset = (page - 1) * pageSize;

  const conds: string[] = [];
  const args: any[] = [];

  if (q) {
    args.push(q);
    // Literal substring search: '%' and '_' in a filter must not widen a purge.
    conds.push(
      "(POSITION(LOWER($" +
        args.length +
        ") IN LOWER(message)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(level)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(category)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(COALESCE(meta::text,''))) > 0)"
    );
  }
  if (level) {
    args.push(level);
    conds.push("level = $" + args.length);
  }
  if (category) {
    args.push(category);
    conds.push("category = $" + args.length);
  }
  if (user_id) {
    args.push(user_id);
    const at = `$${args.length}`;
    conds.push(/^\d+$/.test(user_id)
      ? `(created_by = ${at}::int OR meta->>'userId' = ${at} OR meta->>'user_id' = ${at})`
      : `(meta->>'userId' = ${at} OR meta->>'user_id' = ${at})`);
  }
  if (action) {
    args.push(action);
    conds.push(whereEq(hasStructured, "action", "action", args.length));
  }
  if (status) {
    args.push(status);
    conds.push(whereEq(hasStructured, "status", "status", args.length));
  }
  if (correlation_id) {
    args.push(correlation_id);
    conds.push(whereEq(hasStructured, "correlation_id", "correlationId", args.length));
  }
  if (session_id) {
    args.push(session_id);
    conds.push(whereEq(hasStructured, "session_id", "sessionId", args.length));
  }
  if (platform) {
    args.push(platform);
    conds.push(whereEq(hasStructured, "platform", "platform", args.length));
  }
  if (app_version) {
    args.push(app_version);
    conds.push(whereEq(hasStructured, "app_version", "appVersion", args.length));
  }
  if (date_start) {
    args.push(date_start);
    conds.push(`created_at >= $${args.length}::${isDateOnly(date_start) ? "date" : "timestamptz"}`);
  }
  if (date_end) {
    args.push(date_end);
    if (isDateOnly(date_end)) {
      conds.push(`created_at < ($${args.length}::date + interval '1 day')`);
    } else {
      conds.push(`created_at <= $${args.length}::timestamptz`);
    }
  }

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const listSQL = hasStructured
    ? `SELECT id, level, category, message, meta, created_by, created_at,
              action, status, correlation_id, session_id, screen_name, route_name,
              platform, app_version, duration_ms, error_message, stack, device_info
         FROM system_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${args.length + 1} OFFSET $${args.length + 2}`
    : `SELECT id, level, category, message, meta, created_by, created_at,
              meta->>'action' AS action,
              meta->>'status' AS status,
              meta->>'correlationId' AS correlation_id,
              meta->>'sessionId' AS session_id,
              meta->>'screenName' AS screen_name,
              meta->>'routeName' AS route_name,
              meta->>'platform' AS platform,
              meta->>'appVersion' AS app_version,
              NULL::int AS duration_ms,
              meta->>'errorMessage' AS error_message,
              meta->>'stack' AS stack,
              meta->'deviceInfo' AS device_info
         FROM system_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;

  const countSQL = `SELECT COUNT(*)::int AS count FROM system_logs ${where}`;

  const listArgs = args.concat([pageSize, offset]);
  const { rows } = await query(listSQL, listArgs);
  const { rows: [{ count }] } = await query(countSQL, args);

  return NextResponse.json({ items: rows, total: count, page, pageSize });
}

// POST /api/logs
// Accepts either {logs:[...]} or a single log object.
async function handlePOST(req: NextRequest) {
  const cookieAuth = await authorizeAdminRoute(null);
  const bearer = cookieAuth.ok ? null : verifyUserFromRequest(req);
  const bearerIdentity = bearer ? (await query<{ id: string; tenant_id: string | null; is_email_verified: boolean }>(
    `SELECT id, tenant_id, is_email_verified FROM users WHERE id = $1 LIMIT 1`, [bearer.id]
  )).rows[0] : null;
  if (!cookieAuth.ok && (!bearerIdentity || bearerIdentity.is_email_verified === false)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const actor = cookieAuth.ok ? cookieAuth.admin : bearerIdentity;
  const createdBy = actor?.id ?? null;
  const tenantId = cookieAuth.ok ? cookieAuth.tenantId : bearerIdentity?.tenant_id ?? null;
  const limit = await rateLimit(`client-logs:${tenantId ?? "none"}:${createdBy ?? "unknown"}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many log batches", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const bounded = await readBoundedWebhookText(req, MAX_LOG_BATCH_BYTES);
  if (!bounded.ok) return NextResponse.json({ error: bounded.error }, { status: bounded.status });
  let body: unknown;
  try { body = JSON.parse(bounded.text); }
  catch { return NextResponse.json({ error: "Invalid log JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid log payload" }, { status: 400 });
  }
  const list: unknown[] = Array.isArray((body as any).logs) ? (body as any).logs : [body];
  if (list.length < 1 || list.length > 50 ||
      list.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    return NextResponse.json({ error: "Invalid log batch" }, { status: 400 });
  }
  if (list.some((item: any) => !["debug", "info", "warn", "error"].includes(String(item.level || "info").toLowerCase()))) {
    return NextResponse.json({ error: "Invalid log level" }, { status: 400 });
  }
  // "log-admin" holds the log-deletion audit trail and is excluded from every purge; a client row
  // there would look like a deletion audit event that no platform admin could remove.
  if (list.some((item: any) => String(item.category ?? "").trim().toLowerCase() === "log-admin")) {
    return NextResponse.json({ error: "Reserved log category" }, { status: 400 });
  }

  let insertedCount = 0;
  for (const raw of list as Record<string, any>[]) {
    const requestedLevel = String(raw?.level || "info").toLowerCase();
    const level = requestedLevel;
    const category = String(raw?.category || "mobile").slice(0, 80);
    const message = String(raw?.message || raw?.action || "client log").slice(0, 2_000);
    const meta = raw?.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? raw.meta : {};

    const mergedMeta = {
      ...meta,
      // Ensure server can attribute logs even if client didn't send userId.
      userId: createdBy,
      tenantId,
      source: "client",

      // Preserve structured fields at top-level inside meta too.
      action: raw?.action ?? meta?.action,
      status: raw?.status ?? meta?.status,
      correlationId: raw?.correlationId ?? meta?.correlationId,
      sessionId: raw?.sessionId ?? meta?.sessionId,
      screenName: raw?.screenName ?? meta?.screenName,
      routeName: raw?.routeName ?? meta?.routeName,
      platform: raw?.platform ?? meta?.platform,
      appVersion: raw?.appVersion ?? meta?.appVersion,
      durationMs: raw?.durationMs ?? meta?.durationMs,
      errorMessage: raw?.errorMessage ?? meta?.errorMessage,
      stack: raw?.stack ?? meta?.stack,
      deviceInfo: raw?.deviceInfo ?? meta?.deviceInfo,
    };

    const ok = await writeLogServer(level as any, category, message, mergedMeta, { alert: false });
    if (ok) insertedCount += 1;
  }

  const ok = insertedCount === list.length;
  return NextResponse.json({ ok, insertedCount }, { status: ok ? 201 : 503 });
}

// DELETE /api/logs
// - ids=1,2,3 (bulk delete)
// - OR purge by filter (refuses if no conditions)
async function handleDELETE(req: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  if (req.headers.get("x-bms-confirmed") !== "true") {
    return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  }
  const hasStructured = await ensureStructuredColsReady();
  const { searchParams } = new URL(req.url);

  const idsParam = (searchParams.get("ids") || "").trim();
  if (idsParam) {
    const rawIds = idsParam.split(",").map((s) => s.trim());
    if (rawIds.length < 1 || rawIds.length > 200 || rawIds.some((id) =>
      !LOG_ID_RE.test(id) || (/^\d+$/.test(id) && BigInt(id) > 9_223_372_036_854_775_807n))) {
      return NextResponse.json({ error: "No valid ids" }, { status: 400 });
    }

    const deleted = await deleteLogsWithAudit(
      `DELETE FROM system_logs WHERE id::text = ANY($1::text[]) AND category <> 'log-admin'`,
      [[...new Set(rawIds)]], auth.adminId, "selected"
    );
    return NextResponse.json({ deleted }, { status: 200 });
  }

  const q = (searchParams.get("q") || "").trim();
  const level = (searchParams.get("level") || "").trim();
  const category = (searchParams.get("category") || "").trim();
  const user_id = (searchParams.get("user_id") || "").trim();
  const action = (searchParams.get("action") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const correlation_id = (searchParams.get("correlation_id") || "").trim();
  const session_id = (searchParams.get("session_id") || "").trim();
  const platform = (searchParams.get("platform") || "").trim();
  const app_version = (searchParams.get("app_version") || "").trim();
  const date_start = (searchParams.get("date_start") || "").trim();
  const date_end = (searchParams.get("date_end") || "").trim();
  if ((user_id && !validUserId(user_id)) || q.length > 200 ||
      (date_start && !validLogDate(date_start)) ||
      (date_end && !validLogDate(date_end))) {
    return NextResponse.json({ error: "Invalid log filters" }, { status: 400 });
  }

  const conds: string[] = [];
  const args: any[] = [];

  if (q) {
    args.push(q);
    conds.push(
      "(POSITION(LOWER($" +
        args.length +
        ") IN LOWER(message)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(level)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(category)) > 0 OR POSITION(LOWER($" +
        args.length +
        ") IN LOWER(COALESCE(meta::text,''))) > 0)"
    );
  }
  if (level) {
    args.push(level);
    conds.push("level = $" + args.length);
  }
  if (category) {
    args.push(category);
    conds.push("category = $" + args.length);
  }
  if (user_id) {
    args.push(user_id);
    const at = `$${args.length}`;
    conds.push(/^\d+$/.test(user_id)
      ? `(created_by = ${at}::int OR meta->>'userId' = ${at} OR meta->>'user_id' = ${at})`
      : `(meta->>'userId' = ${at} OR meta->>'user_id' = ${at})`);
  }
  if (action) {
    args.push(action);
    conds.push(whereEq(hasStructured, "action", "action", args.length));
  }
  if (status) {
    args.push(status);
    conds.push(whereEq(hasStructured, "status", "status", args.length));
  }
  if (correlation_id) {
    args.push(correlation_id);
    conds.push(whereEq(hasStructured, "correlation_id", "correlationId", args.length));
  }
  if (session_id) {
    args.push(session_id);
    conds.push(whereEq(hasStructured, "session_id", "sessionId", args.length));
  }
  if (platform) {
    args.push(platform);
    conds.push(whereEq(hasStructured, "platform", "platform", args.length));
  }
  if (app_version) {
    args.push(app_version);
    conds.push(whereEq(hasStructured, "app_version", "appVersion", args.length));
  }
  if (date_start) {
    args.push(date_start);
    conds.push(`created_at >= $${args.length}::${isDateOnly(date_start) ? "date" : "timestamptz"}`);
  }
  if (date_end) {
    args.push(date_end);
    if (isDateOnly(date_end)) {
      conds.push(`created_at < ($${args.length}::date + interval '1 day')`);
    } else {
      conds.push(`created_at <= $${args.length}::timestamptz`);
    }
  }

  if (!conds.length) {
    return NextResponse.json({ error: "Refuse to purge without any condition" }, { status: 400 });
  }

  const sql = `DELETE FROM system_logs WHERE category <> 'log-admin' AND ${conds.join(" AND ")}`;
  const deleted = await deleteLogsWithAudit(sql, args, auth.adminId, "filters");
  return NextResponse.json({ deleted });
}

export const GET = withRouteErrorLog("GET /api/logs", handleGET);
export const POST = withRouteErrorLog("POST /api/logs", handlePOST);
export const DELETE = withRouteErrorLog("DELETE /api/logs", handleDELETE);
