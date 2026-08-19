import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

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

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const hasStructured = await ensureStructuredColsReady();

  const sql = hasStructured
    ? `SELECT id, level, category, message, meta, created_by, created_at,
              action, status, correlation_id, session_id, screen_name, route_name,
              platform, app_version, duration_ms, error_message, stack, device_info
         FROM system_logs
        WHERE id = $1
        LIMIT 1`
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
        WHERE id = $1
        LIMIT 1`;

  const { rows } = await query(sql, [id]);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Log not found" }, { status: 404 });
  return NextResponse.json(row);
}

export const GET = withRouteErrorLog("GET /api/logs/[id]", handleGET);
