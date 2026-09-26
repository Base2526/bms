import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  createRetailLocalReleaseAsset,
  listRetailLocalReleaseAssets,
  RetailLocalReleaseError,
} from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  const releases = await listRetailLocalReleaseAssets({ includeHidden: true });
  return NextResponse.json({ releases }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const release = await createRetailLocalReleaseAsset({
      file,
      platform: form.get("platform"),
      packageType: form.get("packageType"),
      version: form.get("version"),
      channel: form.get("channel") || "pilot",
      status: form.get("status") || "supported",
      isLatest: form.get("isLatest"),
      minOs: form.get("minOs"),
      releaseNotes: form.get("releaseNotes"),
      adminId: auth.adminId,
    });
    return NextResponse.json({ release }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/releases", handleGET);
export const POST = withRouteErrorLog("POST /api/admin/retail-local/releases", handlePOST);
