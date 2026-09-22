// สร้างเคส AI Pharmacy Intake ตัวอย่าง 5 สถานการณ์ตามที่ระบุไว้ (ปกติ/ข้อมูลไม่ครบ/แพ้ยา/
// กลุ่มเสี่ยง/Red Flag ฉุกเฉิน) เพื่อทดสอบหน้า /admin/pharmacy-queue โดยไม่ต้องเดินสายแชทจริง
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import {
  deleteFakePharmacyAssessments,
  seedFakePharmacyAssessments,
} from "@/lib/bms/devPharmacySeed";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const result = await seedFakePharmacyAssessments(tenantId);
    return NextResponse.json({
      ok: true,
      created: result.created,
      protocolsCreated: result.protocolsCreated,
      summary: `สร้างเคสตัวอย่าง ${result.created.length} เคส (${result.labels.join(", ")})`,
    });
  } catch (e: any) {
    const message = e?.message || "insert failed";
    const status = message === "ไม่พบร้านที่เลือก" || message.startsWith("ร้านนี้ยังไม่มีผู้ใช้ role Pharmacist") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handleDELETE(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const deleted = await deleteFakePharmacyAssessments(tenantId);
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-pharmacy-assessments", handlePOST);
export const DELETE = withRouteErrorLog("DELETE /api/dev/fake/bms-pharmacy-assessments", handleDELETE);
