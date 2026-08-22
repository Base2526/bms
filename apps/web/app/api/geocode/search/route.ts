import { NextRequest, NextResponse } from "next/server";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

type PlaceResult = {
  placeName: string;
  latitude: number;
  longitude: number;
};

async function handleGET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") ?? "").trim();

    if (q.length < 3) {
      return NextResponse.json({ results: [] satisfies PlaceResult[] });
    }

    if (q.length > 200) {
      return NextResponse.json({ results: [] satisfies PlaceResult[] });
    }

    const upstream =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=" +
      encodeURIComponent(q);

    const resp = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        "User-Agent": "JachoeiWeb/1.0",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      return NextResponse.json({ results: [] satisfies PlaceResult[] }, { status: 200 });
    }

    const json = (await resp.json()) as any;
    const arr: any[] = Array.isArray(json) ? json : [];

    const results: PlaceResult[] = arr
      .map((r) => {
        const latitude = Number(r?.lat);
        const longitude = Number(r?.lon);
        const placeName = String(r?.display_name ?? "").trim();
        if (!placeName) return null;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return { placeName, latitude, longitude } satisfies PlaceResult;
      })
      .filter((v): v is PlaceResult => !!v);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}

export const GET = withRouteErrorLog("GET /api/geocode/search", handleGET);
