import { NextResponse } from "next/server";
import { listBmsPublicPlans, type PresalesLocale } from "@/lib/bms/platformPresales";
import { renderPublicPackagePdf } from "@/lib/bms/publicPackagePdf";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

export const GET = withRouteErrorLog("GET /api/public/packages/pdf", async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimit(`public-package-pdf:${ip.slice(0, 128)}`, 30, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "RATE_LIMITED" }, {
    status: 429,
    headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" },
  });
  const locale: PresalesLocale = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "th";
  const plans = await listBmsPublicPlans();
  const pdf = await renderPublicPackagePdf(plans, locale);
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok",
  }).format(new Date());
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bms-packages-${date}-${locale}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
