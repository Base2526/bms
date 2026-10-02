import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
import { recordRetailLocalInstallation, RetailLocalInstallationError } from "@/lib/bms/retailLocalInstallations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const sourceKey = crypto.createHash("sha256").update(source).digest("hex").slice(0, 24);
  if (!(await rateLimit(`retail-local-installation-source:${sourceKey}`, 60, 3600_000)).ok) return reply({ error: "rate_limited" }, 429);
  const secret = /^Bearer (bmsit_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "")?.[1] || "";
  try { return reply(await recordRetailLocalInstallation(await readRetailLocalJSON(request), secret), 202); }
  catch (error) {
    if (error instanceof RetailLocalRequestBodyError || error instanceof RetailLocalInstallationError) return reply({ error: error.message }, error.status);
    return reply({ error: "installation_registry_unavailable" }, 503);
  }
}
