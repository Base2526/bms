import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listTechnicalSpecs, stageTechnicalSpecs, publishTechnicalSpecs } from "@/lib/bms/productTechnicalSpecs";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const auth = await authorizeAdminRoute("product.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const sku = (await params).sku?.trim();
  if (!sku) return NextResponse.json({ error: "sku required" }, { status: 400 });
  return NextResponse.json({ items: await listTechnicalSpecs(auth.tenantId, sku) });
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const body = await req.json().catch(() => null);
  const publish = body?.action === "PUBLISH";
  const auth = await authorizeAdminRoute(publish ? "product.spec.publish" : "product.edit");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const sku = (await params).sku?.trim();
  if (!sku || !body || (body.action !== "STAGE" && body.action !== "PUBLISH")) {
    return NextResponse.json({ status: "INVALID_INPUT" }, { status: 400 });
  }
  if (publish && body.confirmed !== true) return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  const result = publish
    ? await publishTechnicalSpecs(auth.tenantId, String(auth.adminId), sku,
      body.variantCode, body.revisionNo)
    : await stageTechnicalSpecs(auth.tenantId, String(auth.adminId), {
        sku, variantCode: body.variantCode, lengthMm: body.lengthMm, widthMm: body.widthMm,
        diameterMm: body.diameterMm, thicknessMm: body.thicknessMm,
        nominalWeightG: body.nominalWeightG, grade: body.grade,
        standardCode: body.standardCode, usageLimitations: body.usageLimitations,
        sourceReference: body.sourceReference, requestKey: body.requestKey,
      });
  const status = result.status === "DRAFT" || result.status === "PUBLISHED" ? 200
    : result.status === "INVALID_INPUT" ? 400 : 409;
  return NextResponse.json(result, { status });
}

export const GET = withRouteErrorLog("GET /api/bms/product-specs/[sku]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/product-specs/[sku]", handlePOST);
