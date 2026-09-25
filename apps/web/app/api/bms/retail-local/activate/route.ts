import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { redeemRetailLocalActivationCode, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const sourceKey = crypto.createHash("sha256").update(source).digest("hex").slice(0, 24);
  const limited = await rateLimit(`retail-local-activation:${sourceKey}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429,
      headers: { "retry-after": String(limited.retryAfter), "Cache-Control": "no-store" },
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 4096) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const body = JSON.parse(text);
    const activated = await redeemRetailLocalActivationCode(String(body?.activationCode ?? ""));
    return NextResponse.json({
      ...activated,
      evidenceEndpoint: new URL("/api/bms/retail-local/license-evidence", request.url).toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/bms/retail-local/activate", handlePOST);
