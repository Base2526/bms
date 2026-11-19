import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { getFishOwnerOptions } from "@/lib/bms/fishOwnerRead";
import { FishOwnerError } from "@/lib/bms/fishOwnerOperations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  let allowed = false;
  for (const permission of ["order.create", "shipping.update"] as const) {
    try { await requirePermission(auth.ctx, permission); allowed = true; break; }
    catch { /* The other role may still allow using the selector. */ }
  }
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await getFishOwnerOptions(auth.tenantId, String(auth.adminId), req.nextUrl.searchParams.get("search") ?? ""));
  } catch (error) {
    if (error instanceof FishOwnerError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    throw error;
  }
}
export const GET = withRouteErrorLog("GET /api/bms/fish-owner/options", handleGET);
