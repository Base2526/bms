// apps/web/app/api/dev/fake/bms-coupons/route.ts
// สร้าง BMS coupons ปลอม (mix PERCENT/FIXED, บางอันปิดใช้งาน/มีขั้นต่ำ/จำกัดจำนวน) เพื่อทดสอบหน้า Coupons
// marker: note ขึ้นต้น 'FAKE' → cleanup ลบได้
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakeCoupons } from "@/lib/bms/devSeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 5, 1), 200);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const created = await seedFakeCoupons(tenantId, count);
    return NextResponse.json({ ok: true, created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}
