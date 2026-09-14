import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fakeSeedDisabled, requirePlatformAdminSeeder, resolveExistingTenantId } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import {
  seedFakeBoardGameCafe,
  seedFakeCustomers,
  seedFakeMembers,
} from "@/lib/bms/devSeed";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) {
    return NextResponse.json(
      { error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" },
      { status: 403 }
    );
  }
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Math.trunc(Number(body?.count) || 8), 4), 30);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const fakeCustomers = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bms_customers
        WHERE tenant_id = $1 AND deleted_at IS NULL AND 'fake' = ANY(tags)`,
      [tenantId]
    );
    if (Number(fakeCustomers.rows[0]?.count ?? 0) < 4) {
      await seedFakeCustomers(tenantId, Math.max(8, count));
    }
    const members = await seedFakeMembers(tenantId, Math.min(Math.max(4, count), 12));
    const result = await seedFakeBoardGameCafe(tenantId, count);
    return NextResponse.json({ ok: true, created: result.created, summary: { ...result.summary, members: members.members } });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "board-game seed failed" },
      { status: error?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 }
    );
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-board-game", handlePOST);
