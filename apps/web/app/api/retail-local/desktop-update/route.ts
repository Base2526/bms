import { NextRequest, NextResponse } from "next/server";
import { getDesktopReleaseUpdates } from "@/lib/bms/retailLocalReleases";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  // Public (desktop shells poll every 30 minutes without a session) and every call reads the
  // release table, so it needs the same per-IP bound as the other public routes. 120/min leaves
  // room for many registers behind one shop NAT plus manual "check now".
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "unknown";
  const limited = await rateLimit(`desktop-update:${ip.slice(0, 128)}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } },
    );
  }
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
