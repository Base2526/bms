// apps/web/app/api/dev/fake/users/route.ts
// สร้าง BMS staff ปลอม (role Sales/Warehouse สุ่ม) ให้ร้านของผู้ล็อกอิน — สำหรับเทสหน้า Users/สิทธิ์
// logic การ insert จริงอยู่ที่ lib/bms/devSeed.ts (ใช้ร่วมกับ provisionTestShop())
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { seedFakeStaff } from "@/lib/bms/devSeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 3, 1), 200);
  // seed ลงร้านของผู้ล็อกอิน (เห็นใน /admin/users ของร้านตัวเองทันที) — fallback: default tenant
  const tenantId = guard.actor?.tenant_id || DEFAULT_TENANT_ID;

  const created = await seedFakeStaff(tenantId, count, guard.actor?.id);
  return NextResponse.json({ ok: true, created });
}
