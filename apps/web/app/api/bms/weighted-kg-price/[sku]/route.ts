import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { currentWeightedKgRate, publishWeightedKgRate } from "@/lib/bms/weightedKgPricing";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest, {params}:{params:{sku:string}}) {
  const auth = await authorizeAdminRoute("product.view");
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  const sku = params.sku?.trim();
  const size = req.nextUrl.searchParams.get("size")?.trim();
  if (!sku || !size) return NextResponse.json({status:"INVALID_INPUT"},{status:400});
  const rate = await currentWeightedKgRate({query},auth.tenantId,sku,size);
  return NextResponse.json({status:"OK",rate:rate ? {
    ...rate, rateBahtPerKg:(Number(rate.rateCents)/100).toFixed(2)
  }:null});
}

async function handlePOST(req: NextRequest, {params}:{params:{sku:string}}) {
  const auth = await authorizeAdminRoute("product.weighted_price.publish");
  if (!auth.ok) return NextResponse.json({error:auth.status===401?"unauthorized":"forbidden"},{status:auth.status});
  const body = await req.json().catch(() => null);
  const result = await publishWeightedKgRate(auth.tenantId,String(auth.adminId),{
    sku:params.sku,size:body?.size,rateBahtPerKg:body?.rateBahtPerKg,
    requestKey:body?.requestKey,confirmed:body?.confirmed===true,
  });
  return NextResponse.json(result,{status:result.status==="PUBLISHED"?200
    :result.status==="INVALID_INPUT"?400:409});
}

export const GET = withRouteErrorLog("GET /api/bms/weighted-kg-price/[sku]",handleGET);
export const POST = withRouteErrorLog("POST /api/bms/weighted-kg-price/[sku]",handlePOST);
