import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  // Same Nominatim budget as /api/geocode/search (shared "geocode:*" keys): per IP and overall.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "unknown";
  const perIp = await rateLimit(`geocode:${ip.slice(0, 128)}`, 30, 60_000);
  const overall = perIp.ok ? await rateLimit("geocode:all", 60, 60_000) : perIp;
  if (!perIp.ok || !overall.ok) {
    return NextResponse.json(
      { placeName: null, error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String((perIp.ok ? overall : perIp).retryAfter) } },
    );
  }
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ placeName: null });
    }

    const upstream =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=" +
      encodeURIComponent(String(lat)) +
      "&lon=" +
      encodeURIComponent(String(lng));

    const resp = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        "User-Agent": "JachoeiWeb/1.0",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      return NextResponse.json({ placeName: null }, { status: 200 });
    }

    const json = (await resp.json()) as any;
    const placeName = String(json?.display_name ?? "").trim() || null;

    return NextResponse.json({ placeName });
  } catch {
    return NextResponse.json({ placeName: null }, { status: 200 });
  }
}

export const GET = withRouteErrorLog("GET /api/geocode/reverse", handleGET);
