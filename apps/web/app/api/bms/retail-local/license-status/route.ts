import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { getRetailLocalHostLicenseStatus, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  // Limit source attempts before token lookup, so rotating random invalid tokens
  // cannot obtain a fresh rate-limit bucket for every database query.
  const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const sourceKey = crypto.createHash("sha256").update(source).digest("hex");
  if (!(await rateLimit(`local-license-status-source:${sourceKey}`, 120, 60_000)).ok) return reply({ error: "rate_limited" }, 429);
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  const limited = await rateLimit(`local-license-status:${crypto.createHash("sha256").update(token).digest("hex")}`, 30, 60_000);
  if (!limited.ok) return reply({ error: "rate_limited" }, 429);
  try {
    const body = await readRetailLocalJSON(request) as Record<string, unknown> | null;
    return reply(await getRetailLocalHostLicenseStatus(token, String(body?.installationId ?? "")));
  } catch (error) {
    if (error instanceof RetailLocalRequestBodyError) return reply({ error: error.message }, error.status);
    if (error instanceof RetailLocalLicenseError) return reply({ error: error.message }, error.status);
    return reply({ error: "status_unavailable" }, 503);
  }
}
