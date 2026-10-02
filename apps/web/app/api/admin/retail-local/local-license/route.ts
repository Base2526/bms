import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getLocalLicense, requestLocalLicenseActivation, LocalLicenseError } from "@/lib/bms/localLicense";
import { isRetailLocalDeployment } from "@/lib/bms/deploymentMode";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof RetailLocalRequestBodyError) return reply({ error: error.message }, error.status);
  return reply({ error: error instanceof LocalLicenseError ? error.message : "runtime_unavailable" }, error instanceof LocalLicenseError ? error.status : 503);
}
export async function GET() {
  if (!isRetailLocalDeployment()) return reply({ error: "not_found" }, 404);
  const auth = await authorizeAdminRoute("retail_local.license.view");
  if (!auth.ok) return reply({ error: "forbidden" }, auth.status);
  try { return reply(await getLocalLicense(auth.tenantId)); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (!isRetailLocalDeployment()) return reply({ error: "not_found" }, 404);
  const auth = await authorizeAdminRoute("retail_local.license.manage");
  if (!auth.ok) return reply({ error: "forbidden" }, auth.status);
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "invalid_origin" }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "invalid_content_type" }, 415);
  try { return reply(await requestLocalLicenseActivation(auth.ctx, await readRetailLocalJSON(request)), 202); }
  catch (error) { return error instanceof SyntaxError ? reply({ error: "invalid_json" }, 400) : failure(error); }
}
