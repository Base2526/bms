import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fakeSeedDisabled, requirePlatformAdminSeeder, resolveExistingTenantId } from "@/lib/dev-guards";
import {
  evaluateFakeGroundTruth,
  generateFakeGroundTruth,
  getFakeGroundTruth,
} from "@/lib/bms/fakeEvaluation";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize() {
  if (fakeSeedDisabled()) {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 }),
    };
  }
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { authorized: true as const, guard };
}

async function handleGET(req: NextRequest) {
  const auth = await authorize();
  if (!auth.authorized) return auth.response;
  try {
    const tenantId = await resolveExistingTenantId(
      req.nextUrl.searchParams.get("tenantId"),
      auth.guard.actor?.tenant_id
    );
    const run = await getFakeGroundTruth(tenantId, req.nextUrl.searchParams.get("runId"));
    return NextResponse.json({ ok: true, run });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "load ground truth failed" }, { status: 400 });
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorize();
  if (!auth.authorized) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, auth.guard.actor?.tenant_id);
    const run = await generateFakeGroundTruth(tenantId, {
      label: typeof body?.label === "string" ? body.label : undefined,
      generatedBy: auth.guard.actor?.id,
    });
    return NextResponse.json({ ok: true, run });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "generate ground truth failed" }, { status: 400 });
  }
}

async function handlePUT(req: NextRequest) {
  const auth = await authorize();
  if (!auth.authorized) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, auth.guard.actor?.tenant_id);
    if (typeof body?.runId !== "string" || !body.runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    const result = await evaluateFakeGroundTruth(
      tenantId,
      body.runId,
      body.answers,
      auth.guard.actor?.id
    );
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "score ground truth failed" }, { status: 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/dev/fake/ground-truth", handleGET);
export const POST = withRouteErrorLog("POST /api/dev/fake/ground-truth", handlePOST);
export const PUT = withRouteErrorLog("PUT /api/dev/fake/ground-truth", handlePUT);
