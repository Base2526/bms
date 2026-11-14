import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { fishIntakeOptions } from "@/lib/bms/fishIntake";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function handleGET(req:NextRequest) {
  const auth=await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  try { await requirePermission(auth.ctx,"purchase.view"); }
  catch {
    try { await requirePermission(auth.ctx,"inventory.count"); }
    catch {return NextResponse.json({error:"forbidden"},{status:403});}
  }
  const search=req.nextUrl.searchParams.get("search")??"";
  if (search.length>100) return NextResponse.json({error:"คำค้นยาวเกินไป"},{status:400});
  return NextResponse.json(await fishIntakeOptions(auth.tenantId,String(auth.adminId),search));
}
export const GET=withRouteErrorLog("GET /api/bms/fish-intake/options",handleGET);
