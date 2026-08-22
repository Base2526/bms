// apps/web/app/api/dev/fake/bms-products/route.ts
// สร้าง BMS products + inventory (S/M/L/XL) จำนวนมาก — mark ด้วย SKU prefix 'FAKE-' + keyword 'fake' เพื่อ cleanup ได้
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakeProducts } from "@/lib/bms/devSeed";
import { getStoreProfile } from "@/lib/bms/storeProfile";
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
    const count = Math.min(Math.max(Number(body?.count) || 5, 1), 2000);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const profile = await getStoreProfile(tenantId);
    const businessArchetype = normalizeShopArchetype(profile.businessArchetype);
    const created = await seedFakeProducts(tenantId, count, businessArchetype);
    return NextResponse.json({ ok: true, businessArchetype, created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-products", handlePOST);
