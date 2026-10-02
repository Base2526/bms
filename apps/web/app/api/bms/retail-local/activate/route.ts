import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { redeemRetailLocalActivationCode, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";

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
  try {
    const body = await readRetailLocalJSON(request) as Record<string, unknown> | null;
    if (body?.requestId !== undefined && typeof body.requestId !== "string" ||
        body?.currentLicenseCode !== undefined && typeof body.currentLicenseCode !== "string") {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const activated = await redeemRetailLocalActivationCode(String(body?.activationCode ?? ""), body?.requestId, body?.currentLicenseCode);
    return NextResponse.json(activated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalRequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/bms/retail-local/activate", handlePOST);
