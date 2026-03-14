import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/admin/log-categories
export async function GET() {
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
