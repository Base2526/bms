import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { rateLimit } from "@/lib/bms/rateLimit";
import { submitInstallerReport } from "@/lib/bms/installerReports";
import { InstallerReportError } from "@/lib/bms/installerReportFormat";
import { readInstallerReportUpload } from "@/lib/bms/installerReportUpload";

// Keep the raw Node stream: the App Route adapter can buffer before our size guard.
export const config = { api: { bodyParser: false, responseLimit: "16kb" } };

// Intentionally public: failed first installs have no session. Consent grants no read access.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const fail = (status: number, error: string) => {
    // Do not drain an unbounded rejected body, or reuse a partially consumed connection.
    if (!req.readableEnded) { req.pause(); res.setHeader("Connection", "close"); }
    return res.status(status).json({ error });
  };
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return fail(405, "method_not_allowed"); }
  if (process.env.BMS_INSTALLER_REPORTS_ENABLED !== "true") return fail(503, "reports_unavailable");
  if (req.headers["x-bms-report-consent"] !== "1") return fail(400, "consent_required");
  const type = req.headers["content-type"]?.split(";", 1)[0];
  if (!["application/octet-stream", "application/json", "text/plain"].includes(type || "")) return fail(415, "unsupported_media_type");
  try {
    // The ingress must replace X-Forwarded-For; the fleet cap also bounds spoofed sources.
    const forwarded = req.headers["x-forwarded-for"];
    const source = typeof forwarded === "string" ? forwarded.split(",", 1)[0].trim() : "unknown";
    const key = createHash("sha256").update(source).digest("hex");
    const [sourceLimit, fleetLimit] = await Promise.all([
      rateLimit(`installer-report:source:${key}`, 10, 3600_000),
      rateLimit("installer-report:fleet", 1000, 86400_000),
    ]);
    const limited = !sourceLimit.ok ? sourceLimit : fleetLimit;
    if (!limited.ok) { res.setHeader("Retry-After", String(limited.retryAfter)); return fail(429, "rate_limited"); }
    return res.status(202).json(await submitInstallerReport(await readInstallerReportUpload(req)));
  } catch (error) {
    if (error instanceof InstallerReportError) return fail(error.status, error.message);
    console.error("[installer-reports] submission unavailable");
    return fail(503, "reports_unavailable");
  }
}
