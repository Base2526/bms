import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
