import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { audit } from "@/lib/bms/audit";
import {
  createStarterCatalog,
  deleteSampleData,
  getSampleDataStatus,
  SampleDataError,
} from "@/lib/bms/sampleData";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

function sampleError(error: unknown) {
  if (error instanceof SampleDataError) {
    const status = error.code === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("[BMS] onboarding sample data failed:", error);
  return NextResponse.json({ error: "จัดการข้อมูลตัวอย่างไม่สำเร็จ" }, { status: 500 });
}

async function handleGET() {
  const auth = await authorizeAdminRoute("product.edit");
  if (!auth.ok) return authError(auth.status);

  try {
    const sample = await getSampleDataStatus(auth.tenantId);
    return NextResponse.json({ ok: true, sample });
  } catch (error) {
    return sampleError(error);
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("product.edit");
  if (!auth.ok) return authError(auth.status);

  const body = await req.json().catch(() => ({}));
  if ((body?.mode ?? "STARTER_CATALOG") !== "STARTER_CATALOG") {
    return NextResponse.json(
      { error: "โหมดข้อมูลตัวอย่างนี้ยังไม่เปิดให้ร้านจริง", code: "UNSUPPORTED_MODE" },
      { status: 400 }
    );
  }

  try {
    const sample = await createStarterCatalog(auth.tenantId, auth.adminId);
    await audit(auth.ctx, "sample_data.create", sample.id, {
      mode: sample.mode,
      archetype: sample.archetype,
      products: sample.products.length,
    });
    return NextResponse.json({ ok: true, sample });
  } catch (error) {
    return sampleError(error);
  }
}

async function handleDELETE(req: NextRequest) {
  const auth = await authorizeAdminRoute("product.edit");
  if (!auth.ok) return authError(auth.status);

  const body = await req.json().catch(() => ({}));
  if (body?.confirmation !== "DELETE SAMPLE") {
    return NextResponse.json(
      { error: "กรุณายืนยันด้วยข้อความ DELETE SAMPLE", code: "CONFIRMATION_REQUIRED" },
      { status: 400 }
    );
  }

  try {
    const result = await deleteSampleData(auth.tenantId, auth.adminId);
    await audit(auth.ctx, "sample_data.delete", result.runId, {
      deletedProducts: result.deletedProducts,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return sampleError(error);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/onboarding/sample-data", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/onboarding/sample-data", handlePOST);
export const DELETE = withRouteErrorLog("DELETE /api/bms/onboarding/sample-data", handleDELETE);
