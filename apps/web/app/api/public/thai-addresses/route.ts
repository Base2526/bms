import { NextRequest, NextResponse } from "next/server";
import { listMasterThaiAddresses } from "@/lib/bms/masterData";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 128);
  const limited = await rateLimit(`public-thai-addresses:${ip}`, 120, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const url = new URL(req.url);
  const level = url.searchParams.get("level")?.toUpperCase() || "PROVINCE";
  if (!new Set(["PROVINCE", "DISTRICT", "SUBDISTRICT"]).has(level)) {
    return NextResponse.json({ error: "invalid_level" }, { status: 400 });
  }
  const rows = await listMasterThaiAddresses({
    level,
    provinceCode: url.searchParams.get("provinceCode"),
    districtCode: url.searchParams.get("districtCode"),
    limit: 500,
  });
  return NextResponse.json({ rows: rows.map((row) => ({
    code: row.code, provinceCode: row.provinceCode, districtCode: row.districtCode,
    nameTh: row.nameTh, nameEn: row.nameEn, postcode: row.postcode,
  })) }, { headers: { "Cache-Control": "public, max-age=300" } });
}

export const GET = withRouteErrorLog("GET /api/public/thai-addresses", handleGET);
