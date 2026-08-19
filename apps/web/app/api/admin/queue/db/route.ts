// apps/web/app/api/admin/queue/db/route.ts
import { NextResponse } from "next/server";
import pg from "pg";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { Pool } = pg;

function requireAdmin(req: Request) {
  const token = req.headers.get("x-admin-token");
  const expected = process.env.ADMIN_TOKEN;
  if (expected && token !== expected) throw new Error("unauthorized");
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "postgres",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DB ?? "appdb",
  user: process.env.POSTGRES_USER ?? "app",
  password: process.env.POSTGRES_PASSWORD ?? "app",
});

async function handleGET(req: Request) {
  try {
    requireAdmin(req);

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 80), 1), 200);

    const { rows } = await pool.query(
      `
      SELECT
        sp.post_id,
        sp.platform,
        sp.status,
        sp.social_post_id,
        sp.last_error,
        sp.created_at,
        sp.updated_at
      FROM social_posts sp
      ORDER BY sp.updated_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export const GET = withRouteErrorLog("GET /api/admin/queue/db", handleGET);
