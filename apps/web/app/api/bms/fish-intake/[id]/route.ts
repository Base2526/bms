import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getFishIntake, type FishIntakeKind } from "@/lib/bms/fishIntake";
import { loadPermissions } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function handleGET(_:Request,{params}:{params: Promise<{id:string}>}) {
  const auth=await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  const perms=await loadPermissions(auth.ctx);
  const kinds:FishIntakeKind[]=[];
  if (perms.has("purchase.view")) kinds.push("HISTORICAL","LIVE");
  if (perms.has("inventory.count")) kinds.push("OPENING");
  if (!kinds.length) return NextResponse.json({error:"forbidden"},{status:403});
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((await params).id))
    return NextResponse.json({error:"ไม่พบรายการ"},{status:404});
  const item=await getFishIntake(auth.tenantId,String(auth.adminId),(await params).id,kinds);
  return item?NextResponse.json(item):NextResponse.json({error:"ไม่พบรายการ"},{status:404});
}

export const GET=withRouteErrorLog("GET /api/bms/fish-intake/[id]",handleGET);
