import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
import { confirmRetailCart, previewRetailCart } from "@/lib/bms/retailCart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** Public storefront: shop identity comes from the slug or a purpose-bound quote token. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimit(`retail-cart:ip:${ip}`, 30, 60_000);
  if (!limited.ok) return NextResponse.json({ status: "RATE_LIMITED" }, {
    status: 429, headers: { ...headers, "Retry-After": String(limited.retryAfter) },
  });
  try {
    const body = await readRetailLocalJSON(req, 8192) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ status: "INVALID" }, { status: 400, headers });
    if (body.action === "preview") {
      const result = await previewRetailCart(body.tenantSlug, body.items);
      return NextResponse.json(result, { status: result.status === "READY" ? 200 : 400, headers });
    }
    if (body.action === "confirm" && typeof body.quoteToken === "string") {
      const digest = createHash("sha256").update(body.quoteToken).digest("hex");
      const byToken = await rateLimit(`retail-cart:token:${digest}`, 8, 60_000);
      if (!byToken.ok) return NextResponse.json({ status: "RATE_LIMITED" }, {
        status: 429, headers: { ...headers, "Retry-After": String(byToken.retryAfter) },
      });
      const result = await confirmRetailCart(body.quoteToken);
      return NextResponse.json(result, { status: result.status === "CREATED" ? 200 : result.status === "REVIEW_REQUIRED" ? 409 : 400, headers });
    }
    return NextResponse.json({ status: "INVALID" }, { status: 400, headers });
  } catch (error) {
    if (error instanceof RetailLocalRequestBodyError)
      return NextResponse.json({ status: "INVALID" }, { status: error.status, headers });
    return NextResponse.json({ status: "UNAVAILABLE" }, { status: 503, headers });
  }
}
