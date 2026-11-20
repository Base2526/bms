import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { fishLateCost, FishLateCostError, type FishLateCostInput } from "@/lib/bms/fishLateCost";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function handlePOST(req:NextRequest,{params}:{params:{id:string}}) {
  const auth=await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  try {
    await requirePermission(auth.ctx,"purchase.view");
    await requirePermission(auth.ctx,"purchase.edit");
  } catch {return NextResponse.json({error:"forbidden"},{status:403});}
  const body=await req.json().catch(()=>null) as {action?:unknown;input?:FishLateCostInput;
    confirmed?:unknown;previewHash?:unknown}|null;
  if (!body || (body.action!=="preview"&&body.action!=="commit") || !body.input)
    return NextResponse.json({error:"คำขอไม่ถูกต้อง",code:"INVALID_REQUEST"},{status:400});
  try {
    const result=await fishLateCost(auth.tenantId,String(auth.adminId),params.id,body.input,
      body.action,body.confirmed===true,typeof body.previewHash==="string"?body.previewHash:undefined);
    return NextResponse.json(result,{status:result.status==="SAVED"?201:200});
  } catch(error) {
    if (error instanceof FishLateCostError)
      return NextResponse.json({error:error.message,code:error.code},
        {status:["IDEMPOTENCY_CONFLICT","PREVIEW_STALE"].includes(error.code)?409:
          error.code==="INTAKE_LINE_NOT_FOUND"?404:400});
    throw error;
  }
}
export const POST=withRouteErrorLog("POST /api/bms/fish-intake/[id]/late-cost",handlePOST);
