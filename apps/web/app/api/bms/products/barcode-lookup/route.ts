import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";
import { lookupProductBarcode } from "@/lib/bms/productBarcodeLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("product.edit");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!code.trim() || code.length > 512) return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  const limit = await rateLimit(`product-barcode:${auth.tenantId}:${auth.adminId}`, 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "RATE_LIMITED" }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfter) },
  });
  try {
    return NextResponse.json(await lookupProductBarcode(auth.tenantId, code), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "LOOKUP_UNAVAILABLE" }, { status: 503 });
  }
}
