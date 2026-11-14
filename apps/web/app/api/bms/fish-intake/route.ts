import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { FishIntakeError, fishIntakePreview, listFishIntakes, saveFishIntake,
  type FishIntakeInput } from "@/lib/bms/fishIntake";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function handleGET() {
  const auth=await authorizeAdminRoute("purchase.view");
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  return NextResponse.json({items:await listFishIntakes(auth.tenantId)});
}

async function handlePOST(req:NextRequest) {
  const auth=await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  const body=await req.json().catch(()=>null) as {action?:unknown;confirmed?:unknown;previewHash?:unknown;input?:FishIntakeInput}|null;
  if (!body || !body.input || (body.input.kind!=="LIVE"&&body.input.kind!=="OPENING") ||
      (body.action!=="preview"&&body.action!=="commit"))
    return NextResponse.json({error:"คำขอไม่ถูกต้อง"},{status:400});
  try {
    if (body.input.kind==="LIVE") {
      await requirePermission(auth.ctx,body.action==="commit"?"purchase.receive":"purchase.view");
      if (body.action==="commit") await requirePermission(auth.ctx,"purchase.edit");
    } else {
      await requirePermission(auth.ctx,body.action==="commit"?"inventory.count.apply":"inventory.count");
      if (body.action==="commit") await requirePermission(auth.ctx,"report.view");
    }
  } catch { return NextResponse.json({error:"forbidden"},{status:403}); }
  try {
    const preview=fishIntakePreview(body.input);
    if (body.action==="preview") return NextResponse.json(preview);
    if (body.confirmed!==true || body.previewHash!==preview.previewHash)
      return NextResponse.json({error:"ข้อมูลเปลี่ยนหลังตรวจตัวอย่าง กรุณาตรวจใหม่ก่อนยืนยัน"},{status:409});
    const result=await saveFishIntake(auth.tenantId,String(auth.adminId),body.input);
    return NextResponse.json(result,{status:result.status==="SAVED"?201:200});
  } catch(error) {
    if (error instanceof FishIntakeError)
      return NextResponse.json({error:error.message,code:error.code,line:error.line},{status:error.code==="IDEMPOTENCY_CONFLICT"?409:400});
    throw error;
  }
}

export const GET=withRouteErrorLog("GET /api/bms/fish-intake",handleGET);
export const POST=withRouteErrorLog("POST /api/bms/fish-intake",handlePOST);
