// apps/web/app/api/dev/fake/bms-purchase/route.ts
// สร้าง Purchase Orders ปลอม (suppliers + PO + items หลายสถานะ) เพื่อเติมหน้า Purchase
//
// marker: PO note ขึ้นต้น 'FAKE' + supplier name ขึ้นต้น 'FAKE ' → cleanup ลบได้ (items cascade)
// หมายเหตุ: ไม่ขยับสต็อก (ใช้เติมหน้ารายการ) — ถ้าจะเทสต์ receive จริง ให้ทำผ่าน UI /admin/purchase
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakePurchase } from "@/lib/bms/devSeed";
import { normalizeShopArchetype } from "@/lib/bms/shopArchetypes";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 20, 1), 2000);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const archetype = normalizeShopArchetype(body?.businessArchetype);
    const { created, summary } = await seedFakePurchase(tenantId, count, archetype);
    return NextResponse.json({ ok: true, created, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" || e?.message?.includes("ยังไม่มีสินค้า") ? 400 : 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-purchase", handlePOST);
