// apps/web/app/api/dev/fake/bms-customers/route.ts
// สร้าง BMS customers จำนวนมาก — mark ด้วย tag 'fake' เพื่อ cleanup ได้
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { seedFakeCustomers } from "@/lib/bms/devSeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  try {
    const created = await seedFakeCustomers(tenantId, count);
    return NextResponse.json({ ok: true, created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  }
}
