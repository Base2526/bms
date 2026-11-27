import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { userCanAccessLocation } from "@/lib/bms/locations";
import { distributedRateLimit } from "@/lib/bms/rateLimit";
import {
  KIOSK_RELEASE_UUID, KioskDesktopReleaseError, kioskDesktopReleaseDownloadInfo,
  openKioskDesktopReleaseDownload,
} from "@/lib/bms/kioskDesktopReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleRequest(req: NextRequest, { params }: { params: Promise<{ id: string }> }, head = false) {
  const auth = await authorizeAdminRoute("restaurant.floor.manage");
  if (!auth.ok) return NextResponse.json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  if (!KIOSK_RELEASE_UUID.test(locationId)
    || !await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }
  const releaseId = (await params).id;
  if (!KIOSK_RELEASE_UUID.test(releaseId)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  // The Admin button performs one HEAD preflight followed by one GET transfer.
  const limited = await distributedRateLimit(`kiosk-release-download:${auth.adminId}`, 20, 10 * 60_000);
  if (!limited) return NextResponse.json({ code: "RATE_LIMIT_UNAVAILABLE" }, { status: 503 });
  if (!limited.ok) return NextResponse.json({ code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const input = { tenantId: auth.tenantId, locationId, releaseId };
    const download = head ? await kioskDesktopReleaseDownloadInfo(input) : await openKioskDesktopReleaseDownload(input);
    const filename = download.filename;
    return new NextResponse(head ? null : (download as Awaited<ReturnType<typeof openKioskDesktopReleaseDownload>>).stream,
      { headers: {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Length": String(download.size),
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Checksum-SHA256": download.sha256,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store, max-age=0",
    } });
  } catch (error) {
    const status = error instanceof KioskDesktopReleaseError ? error.status : 503;
    return NextResponse.json({ code: status === 404 ? "NOT_FOUND" : "RELEASE_UNAVAILABLE" }, { status });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/kiosk-desktop-releases/[id]/download",
  (req: NextRequest, context: { params: Promise<{ id: string }> }) => handleRequest(req, context));
export const HEAD = withRouteErrorLog("HEAD /api/bms/kiosk-desktop-releases/[id]/download",
  (req: NextRequest, context: { params: Promise<{ id: string }> }) => handleRequest(req, context, true));
