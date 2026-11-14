import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { requirePermission } from "@/lib/bms/permissions";
import { FishIntakeError, saveFishIntake, validateFishIntake } from "@/lib/bms/fishIntake";
import { FishImportError, listFishImportSheets, parseFishImportWorkbook, type FishDateOverrides } from "@/lib/bms/fishImport";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  try {
    const form=await req.formData();
    const action=String(form.get("action")??"preview");
    if (!["inspect","preview","commit"].includes(action))
      return NextResponse.json({error:"action ไม่ถูกต้อง"},{status:400});
    try { await requirePermission(auth.ctx,action==="commit"?"purchase.edit":"purchase.view"); }
    catch { return NextResponse.json({error:"forbidden"},{status:403}); }
    const file=form.get("file");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size<1 || file.size>10*1024*1024)
      return NextResponse.json({error:"รองรับไฟล์ .xlsx ขนาดไม่เกิน 10 MB"},{status:400});
    const buffer=Buffer.from(await file.arrayBuffer());
    if (action==="inspect") {
      const sheets=listFishImportSheets(buffer);
      return NextResponse.json({sheets,suggestedSheet:sheets.includes("01-1068")?"01-1068":sheets[0]});
    }
    const sourceYear=Number(form.get("sourceYear"));
    const sheet=String(form.get("sheet")??"");
    let overrides:FishDateOverrides={};
    const rawOverrides=String(form.get("overrides")??"{}");
    if (rawOverrides.length>30000) return NextResponse.json({error:"รายการแก้วันที่มีขนาดใหญ่เกินไป"},{status:400});
    try { overrides=JSON.parse(rawOverrides) as FishDateOverrides; }
    catch { return NextResponse.json({error:"ข้อมูลแก้วันที่ไม่ถูกต้อง"},{status:400}); }
    if (!overrides || typeof overrides!=="object" || Array.isArray(overrides) || Object.keys(overrides).length>500)
      return NextResponse.json({error:"ข้อมูลแก้วันที่ไม่ถูกต้อง"},{status:400});
    for (const [row,value] of Object.entries(overrides)) {
      if (!/^\d{1,6}$/.test(row) || !value || typeof value!=="object" || Array.isArray(value) ||
          Object.keys(value).some(key=>!["billDate","receivedDate","duplicateDecision"].includes(key)) ||
          (value.billDate!=null && (typeof value.billDate!=="string" || value.billDate.length>10)) ||
          (value.receivedDate!=null && (typeof value.receivedDate!=="string" || value.receivedDate.length>10)) ||
          (value.duplicateDecision!=null && !["KEEP","SKIP"].includes(value.duplicateDecision)))
        return NextResponse.json({error:"ข้อมูลแก้วันที่ไม่ถูกต้อง"},{status:400});
    }
    const preview=parseFishImportWorkbook(buffer,file.name,sourceYear,sheet,overrides);
    if (action==="preview") {
      return NextResponse.json({sourceHash:preview.sourceHash,previewHash:preview.previewHash,
        sheet:preview.sheet,sourceYear:preview.sourceYear,rowCount:preview.rowCount,
        readyCount:preview.readyCount,issues:preview.issues,totals:preview.totals,
        fishNames:preview.fishNames,sample:preview.sample});
    }
    if (preview.issues.length) return NextResponse.json({error:"ยังมีรายการที่ต้องตรวจแก้",issues:preview.issues},{status:409});
    if (form.get("confirmed")!=="true" || form.get("previewHash")!==preview.previewHash)
      return NextResponse.json({error:"ตัวอย่างไม่ตรงกับไฟล์หรือวันที่ที่ตรวจ กรุณาดูตัวอย่างใหม่"},{status:409});
    validateFishIntake(preview.input);
    const result=await saveFishIntake(auth.tenantId,String(auth.adminId),preview.input);
    return NextResponse.json(result,{status:result.status==="SAVED"?201:200});
  } catch(error) {
    if (error instanceof FishIntakeError)
      return NextResponse.json({error:error.message,code:error.code,line:error.line},{status:error.code==="IDEMPOTENCY_CONFLICT"?409:400});
    if (error instanceof FishImportError)
      return NextResponse.json({error:error.message},{status:400});
    throw error;
  }
}

export const POST=withRouteErrorLog("POST /api/bms/fish-intake/import",handlePOST);
