import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  createRetailLocalReleaseAsset,
  listRetailLocalReleaseAssets,
  RetailLocalReleaseError,
} from "@/lib/bms/retailLocalReleases";
import {
  parseRetailLocalReleaseUpload,
  RetailLocalReleaseUploadError,
} from "@/lib/bms/retailLocalReleaseUpload";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const { fields, storedFile } = await parseRetailLocalReleaseUpload(request);

    const release = await createRetailLocalReleaseAsset({
      storedFile,
      platform: fields.platform,
      packageType: fields.packageType,
      version: fields.version,
      channel: fields.channel || "pilot",
      status: fields.status || "supported",
      isLatest: fields.isLatest,
      minOs: fields.minOs,
      releaseNotes: fields.releaseNotes,
      adminId: auth.adminId,
    });
    return NextResponse.json({ release }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError || error instanceof RetailLocalReleaseUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/releases", handleGET);
export const POST = withRouteErrorLog("POST /api/admin/retail-local/releases", handlePOST);
