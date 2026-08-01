// apps/web/app/api/dev/fake/bms-orders/route.ts
// สร้าง BMS orders (backdate กระจาย 30 วัน, หลายสถานะ/ช่องทาง) + พ่วง payment/shipment
// เพื่อเติม Dashboard / Reports / CRM / Payment / Shipping
//
// marker: customer_ref ขึ้นต้น 'FAKE-' → cleanup ลบได้ (items/payments/shipments cascade)
// หมายเหตุ: ไม่ขยับสต็อก (ใช้เติม analytics) — ถ้าจะเทสต์ flow จ่าย/ส่งจริง ให้สั่งผ่าน Playground
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { seedFakeOrders } from "@/lib/bms/devSeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 20, 1), 2000);
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const { created, summary } = await seedFakeOrders(tenantId, count);
    return NextResponse.json({ ok: true, created, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" || e?.message?.includes("ยังไม่มีสินค้า") ? 400 : 500 });
  }
}
