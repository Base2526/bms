// apps/web/app/api/dev/fake/bms-members/route.ts
// ยกลูกค้าปลอมที่มีอยู่แล้วขึ้นเป็นสมาชิก + ลงแต้มตั้งต้น (7.96) เพื่อทดสอบ
// /admin/loyalty และแถบสมาชิกบนจอ POS โดยไม่ต้องสมัครมือทุกครั้ง
//
// ต้องกด "Customers" (และควรกด "Orders" ด้วย เพื่อให้ชั้นสมาชิกกระจายตามยอดซื้อ)
// ก่อนกดปุ่มนี้ — ไม่มีลูกค้าปลอม = ไม่มีใครให้ยกขึ้นเป็นสมาชิก
//
// marker: ใช้ tag 'fake' ของลูกค้าเดิม → cleanup ลบตามลูกค้า และ ledger
// cascade ตามไปเอง (bms_loyalty_ledger.customer_id ON DELETE CASCADE)
// logic จริงอยู่ที่ lib/bms/devSeed.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakeMembers } from "@/lib/bms/devSeed";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 10, 1), 200);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const created = await seedFakeMembers(tenantId, count);
    return NextResponse.json({ ok: true, created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-members", handlePOST);
