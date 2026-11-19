import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { getFishOwnerAllocatedProfit } from "@/lib/bms/fishOwnerNet";
import { FishOwnerError } from "@/lib/bms/fishOwnerOperations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  try {
    for (const permission of ["report.view", "purchase.view", "product.view", "shipping.view", "ar.view",
      "expense.view", "delivery.settlement.view", "tax.document.view"] as const)
      await requirePermission(auth.ctx, permission);
  } catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  try {
    return NextResponse.json(await getFishOwnerAllocatedProfit(auth.tenantId, String(auth.adminId),
      req.nextUrl.searchParams.get("day")));
  } catch (error) {
    if (error instanceof FishOwnerError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    if (error instanceof Error && error.message.endsWith("ALL_BRANCH_ACCESS_REQUIRED"))
      return NextResponse.json({ error: "ต้องมีสิทธิ์ดูข้อมูลทุกสาขาเพื่อจัดสรรค่าใช้จ่ายร่วม" }, { status: 403 });
    throw error;
  }
}
export const GET = withRouteErrorLog("GET /api/bms/fish-owner/net", handleGET);
