import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyUserFromRequest } from "@/lib/auth/server";
import { authorizeAdminRoute, authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";
import { writeLogServer } from "@/lib/log/writeLog.server";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  const conds: string[] = [];
  const args: any[] = [];

  if (q) {
    args.push(`%${q}%`);
    // Always allow searching meta text too.
    conds.push(
      "(LOWER(message) LIKE LOWER($" +
        args.length +
        ") OR LOWER(level) LIKE LOWER($" +
        args.length +
        ") OR LOWER(category) LIKE LOWER($" +
        args.length +
        ") OR LOWER(COALESCE(meta::text,'')) LIKE LOWER($" +
        args.length +
        "))"
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
    const n = parseInt(user_id, 10);
    if (!isNaN(n)) {
      args.push(n);
      conds.push("created_by = $" + args.length);
    }
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
         ORDER BY created_at DESC
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
         ORDER BY created_at DESC
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
  if (!cookieAuth.ok && !bearer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const actor = cookieAuth.ok ? cookieAuth.admin : bearer;
  const createdBy = actor?.id ?? null;
  const tenantId = cookieAuth.ok ? cookieAuth.tenantId : bearer?.tenant_id ?? null;
  const limit = await rateLimit(`client-logs:${tenantId ?? "none"}:${createdBy ?? "unknown"}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many log batches", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const list: any[] = Array.isArray(body?.logs) ? body.logs : [body];
  const capped = list.slice(0, 50);

  let insertedCount = 0;
  for (const raw of capped) {
    const requestedLevel = String(raw?.level || "info").toLowerCase();
    const level = ["debug", "info", "warn", "error"].includes(requestedLevel) ? requestedLevel : "info";
    const category = String(raw?.category || "mobile").slice(0, 80);
    const message = String(raw?.message || raw?.action || "client log").slice(0, 2_000);
    const meta = raw?.meta && typeof raw.meta === "object" ? raw.meta : {};

    const mergedMeta = {
      ...meta,
      // Ensure server can attribute logs even if client didn't send userId.
      userId: createdBy,
      tenantId,

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

    const ok = await writeLogServer(level as any, category, message, mergedMeta);
    if (ok) insertedCount += 1;
  }

  return NextResponse.json({ ok: true, insertedCount }, { status: 201 });
}

// DELETE /api/logs
// - ids=1,2,3 (bulk delete)
// - OR purge by filter (refuses if no conditions)
async function handleDELETE(req: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const hasStructured = await ensureStructuredColsReady();
  const { searchParams } = new URL(req.url);

  const idsParam = (searchParams.get("ids") || "").trim();
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    if (ids.length === 0) {
      return NextResponse.json({ error: "No valid ids" }, { status: 400 });
    }

    const { rowCount } = await query(`DELETE FROM system_logs WHERE id = ANY($1::int[])`, [ids]);
    return NextResponse.json({ deleted: rowCount ?? 0 }, { status: 200 });
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

  const conds: string[] = [];
  const args: any[] = [];

  if (q) {
    args.push(`%${q}%`);
    conds.push(
      "(LOWER(message) LIKE LOWER($" +
        args.length +
        ") OR LOWER(level) LIKE LOWER($" +
        args.length +
        ") OR LOWER(category) LIKE LOWER($" +
        args.length +
        ") OR LOWER(COALESCE(meta::text,'')) LIKE LOWER($" +
        args.length +
        "))"
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
    const n = parseInt(user_id, 10);
    if (!isNaN(n)) {
      args.push(n);
      conds.push("created_by = $" + args.length);
    }
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

  const sql = `DELETE FROM system_logs WHERE ${conds.join(" AND ")}`;
  const result = await query(sql, args);
  return NextResponse.json({ deleted: result.rowCount || 0 });
}

export const GET = withRouteErrorLog("GET /api/logs", handleGET);
export const POST = withRouteErrorLog("POST /api/logs", handlePOST);
export const DELETE = withRouteErrorLog("DELETE /api/logs", handleDELETE);
