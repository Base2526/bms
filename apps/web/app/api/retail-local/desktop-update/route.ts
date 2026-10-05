import { NextRequest, NextResponse } from "next/server";
import { getDesktopReleaseUpdates } from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const version = params.get("version") ?? "";
  const platform = params.get("platform") ?? "";
  const arch = params.get("arch") || undefined;
  if (version.length > 80 || !["win32", "linux", "darwin"].includes(platform)
    || (arch !== undefined && !["x64", "ia32", "arm64", "arm"].includes(arch))) {
    return NextResponse.json({ error: "Invalid desktop metadata" }, { status: 400 });
  }
  const result = await getDesktopReleaseUpdates({ version, platform, arch });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withRouteErrorLog("GET /api/retail-local/desktop-update", handleGET);
