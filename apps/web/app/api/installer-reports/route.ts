import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { submitInstallerReport } from "@/lib/bms/installerReports";
import { InstallerReportError, readInstallerReportBody } from "@/lib/bms/installerReportFormat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intentionally public: a failed first installation has no tenant/session yet.
// Submission grants no identity or read access. Enable only on the central BMS host.
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.BMS_INSTALLER_REPORTS_ENABLED !== "true") return NextResponse.json({ error: "reports_unavailable" }, { status: 503, headers });
  if (request.headers.get("x-bms-report-consent") !== "1") return NextResponse.json({ error: "consent_required" }, { status: 400, headers });
  const type = request.headers.get("content-type")?.split(";", 1)[0];
  if (!["application/octet-stream", "application/json", "text/plain"].includes(type || "")) return NextResponse.json({ error: "unsupported_media_type" }, { status: 415, headers });
  // The ingress proxy must replace X-Forwarded-For; the fleet cap still bounds spoofed sources.
  const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const key = createHash("sha256").update(source).digest("hex");
  const [sourceLimit, fleetLimit] = await Promise.all([
    rateLimit(`installer-report:source:${key}`, 10, 3600_000),
    rateLimit("installer-report:fleet", 1000, 86400_000),
  ]);
  const limited = !sourceLimit.ok ? sourceLimit : fleetLimit;
  if (!limited.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limited.retryAfter) } });
  try {
    return NextResponse.json(await submitInstallerReport(await readInstallerReportBody(request)), { status: 202, headers });
  } catch (error) {
    if (error instanceof InstallerReportError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // Never log uploaded bodies, request headers or raw database errors.
    console.error("[installer-reports] submission unavailable");
    return NextResponse.json({ error: "reports_unavailable" }, { status: 503, headers });
  }
}
