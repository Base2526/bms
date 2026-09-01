import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";

export const dynamic = "force-dynamic";

// GET /api/admin/log-categories
async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const { rows } = await query<{ category: string | null }>(
    `
    SELECT DISTINCT category
    FROM system_logs
    WHERE category IS NOT NULL AND category <> ''
    ORDER BY category
    `
  );

  return NextResponse.json(rows.map((r) => String(r.category)));
}

export const GET = withRouteErrorLog("GET /api/admin/log-categories", handleGET);
