import { NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getAppDownloadSettings, updateAppDownloadSettings } from "@/lib/bms/appDownloadSettings";
import { InvalidAppDownloadSettings } from "@/lib/bms/appDownloadValidation";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export const GET = withRouteErrorLog("GET /api/admin/app-downloads", async () => {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status, headers });
  return NextResponse.json(await getAppDownloadSettings(), { headers });
});

export const PUT = withRouteErrorLog("PUT /api/admin/app-downloads", async (request: Request) => {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status, headers });
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "INVALID_DOWNLOAD_URL" }, { status: 400, headers }); }
  try {
    return NextResponse.json(await updateAppDownloadSettings(auth.ctx, input), { headers });
  } catch (error) {
    if (error instanceof InvalidAppDownloadSettings) {
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    }
    throw error;
  }
});
