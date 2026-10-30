import { NextRequest, NextResponse } from "next/server";
import { createRetailLocalLead, RetailLocalLeadError } from "@/lib/bms/retailLocalLeads";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { isRetailLocalDeployment } from "@/lib/bms/deploymentMode";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  // A shop's own Retail Local install is not where BMS reads leads: saving one
  // there would store personal data nobody follows up on. Cloud only.
  if (isRetailLocalDeployment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  const limited = await rateLimit(`retail-local-lead:${ip.slice(0, 128)}`, 5, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  try {
    await createRetailLocalLead(await readRetailLocalJSON(request));
    return NextResponse.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLeadError || error instanceof RetailLocalRequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    throw new Error("retail_local_lead_unavailable");
  }
}

export const POST = withRouteErrorLog("POST /api/public/retail-local/lead", handlePOST);
