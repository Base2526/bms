// apps/web/app/api/dev/fake/bms-ai-usage/route.ts
// เพิ่ม usage ของ AI shared key รายเดือนเพื่อทดสอบ quota UI โดยไม่ต้องเรียก provider จริง
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 3, 1), 2000);
  const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
  const yearMonth = currentYearMonth();

  try {
    const res = await query<{ count: number }>(
      `INSERT INTO bms_ai_usage_monthly (tenant_id, year_month, count)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, year_month) DO UPDATE SET
         count = bms_ai_usage_monthly.count + EXCLUDED.count,
         updated_at = now()
       RETURNING count`,
      [tenantId, yearMonth, count]
    );

    return NextResponse.json({
      ok: true,
      created: [{ id: `${tenantId}:${yearMonth}`, name: `AI usage +${count}`, count: res.rows[0]?.count ?? count }],
      summary: { aiUsageAdded: count, yearMonth, count: res.rows[0]?.count ?? count },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}
