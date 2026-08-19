// apps/web/app/api/dev/fake/bms-restock-subscriptions/route.ts
// สร้าง fake Restock Subscriptions หลายสถานะ พร้อม chat/identity/delivery history ให้เห็นภาพในหน้า admin
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakeRestockSubscriptions } from "@/lib/bms/devSeed";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 20, 1), 500);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const { created, summary } = await seedFakeRestockSubscriptions(tenantId, count);
    return NextResponse.json({ ok: true, created, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-restock-subscriptions", handlePOST);
