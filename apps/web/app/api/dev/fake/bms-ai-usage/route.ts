// apps/web/app/api/dev/fake/bms-ai-usage/route.ts
// Retired legacy counter: it is not the authoritative monthly point ledger.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ code: "LEGACY_AI_USAGE_RETIRED",
    error: "Legacy AI usage seeding is retired. Use platform-admin AI point adjustments in /admin/billing for a test shop; no provider calls or usage events are fabricated."
  }, { status: 410 });
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-ai-usage", handlePOST);
