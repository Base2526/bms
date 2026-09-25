import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { createRetailLocalLicense, listRetailLocalLicenses, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  return NextResponse.json({ licenses: await listRetailLocalLicenses() }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    const created = await createRetailLocalLicense({
      customerReference: body?.customerReference,
      maxActiveInstallations: body?.maxActiveInstallations,
      licenseType: body?.licenseType,
      adminId: auth.adminId,
    });
    return NextResponse.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/licenses", handleGET);
export const POST = withRouteErrorLog("POST /api/admin/retail-local/licenses", handlePOST);
