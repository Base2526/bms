import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  RetailLocalReleaseError,
  updateRetailLocalReleaseAsset,
} from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  try {
    const body = await request.json();
    const release = await updateRetailLocalReleaseAsset(params.id, {
      status: body?.status,
      isLatest: body?.isLatest,
      minOs: body?.minOs,
      releaseNotes: body?.releaseNotes,
    });
    return NextResponse.json({ release }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const PATCH = withRouteErrorLog("PATCH /api/admin/retail-local/releases/[id]", handlePATCH);
