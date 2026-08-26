// apps/web/app/api/admin/queue/db/route.ts
import { NextResponse } from "next/server";
import pg from "pg";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { Pool } = pg;

// เดิม `if (expected && ...)` = ไม่ตั้ง ADMIN_TOKEN ก็ผ่านทุกคำขอ · route นี้เปิด
// connection pool ของตัวเองไปอ่านคิวในฐานข้อมูล จึงต้อง fail closed เหมือน cron
function requireAdmin(req: Request): NextResponse | null {
  const cron = authorizeCronRequest(req, "x-admin-token", "ADMIN_TOKEN");
  return cron.ok ? null : cron.response;
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
    const denied = requireAdmin(req);
    if (denied) return denied;

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
