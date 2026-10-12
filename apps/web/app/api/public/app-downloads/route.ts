import { NextResponse } from "next/server";
import { getAppDownloadSettings } from "@/lib/bms/appDownloadSettings";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { rateLimit } from "@/lib/bms/rateLimit";

export const dynamic = "force-dynamic";

export const GET = withRouteErrorLog("GET /api/public/app-downloads", async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`app-downloads:${ip.slice(0, 128)}`, 120, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "RATE_LIMITED" }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store" },
  });
  return NextResponse.json(await getAppDownloadSettings(), { headers: { "Cache-Control": "no-store" } });
});
