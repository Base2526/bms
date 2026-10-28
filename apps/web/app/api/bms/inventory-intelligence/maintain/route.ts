import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runInventoryForecastMaintenancePage } from "@/lib/bms/inventoryIntelligence";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function handlePOST(req: NextRequest) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) return auth.response;
  const afterTenant = req.nextUrl.searchParams.get("afterTenant");
  if (afterTenant && !UUID.test(afterTenant)) {
    return NextResponse.json({ok:false,error:"INVALID_AFTER_TENANT"},{status:400});
  }
  try {
    const result = await recordJobRun("inventory-intelligence-maintenance", "cron", async () => {
      const page = await runInventoryForecastMaintenancePage(afterTenant, 25);
      if (page.failed > 0) throw new Error(`Inventory maintenance failed for ${page.failed} tenant(s); retry this page`);
      return page;
    });
    return NextResponse.json({ok:true,...result});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error ? error.message : "failed"},{status:500});
  }
}

export const POST = withRouteErrorLog("POST /api/bms/inventory-intelligence/maintain", handlePOST);
