import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  ingestRetailLocalLicenseEvidence,
  RetailLocalLicenseError,
} from "@/lib/bms/retailLocalLicensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization);
  if (!match) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rateKey = crypto.createHash("sha256").update(match[1]).digest("hex").slice(0, 24);
  const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const sourceKey = crypto.createHash("sha256").update(source).digest("hex").slice(0, 24);
  const [tokenLimit, sourceLimit] = await Promise.all([
    rateLimit(`retail-local-license-evidence:token:${rateKey}`, 120, 60_000),
    rateLimit(`retail-local-license-evidence:source:${sourceKey}`, 300, 60_000),
  ]);
  const limited = tokenLimit.ok ? sourceLimit : tokenLimit;
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429, headers: { "retry-after": String(limited.retryAfter), "Cache-Control": "no-store" },
    });
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/vnd.bms.license-evidence+json" && contentType !== "application/json") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const result = await ingestRetailLocalLicenseEvidence(match[1], JSON.parse(text));
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/bms/retail-local/license-evidence", handlePOST);
