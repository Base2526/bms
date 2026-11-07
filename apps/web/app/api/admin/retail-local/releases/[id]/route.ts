import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  purgeRetailLocalReleaseFile,
  RetailLocalReleaseError,
  updateRetailLocalReleaseAsset,
} from "@/lib/bms/retailLocalReleases";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isSameOrigin(request: NextRequest): boolean {
  const firstHeader = (value: string | null) => (value || "").split(",", 1)[0].trim();
  const origin = firstHeader(request.headers.get("origin"));
  const host = firstHeader(request.headers.get("x-forwarded-host")) || firstHeader(request.headers.get("host"));
  const protocol = firstHeader(request.headers.get("x-forwarded-proto"))
    || new URL(request.url).protocol.slice(0, -1);
  return Boolean(origin && host && ["http", "https"].includes(protocol)
    && origin === `${protocol}://${host}`);
}

function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RetailLocalRequestBodyError("invalid_body", 400);
  }
  return value as Record<string, unknown>;
}

async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  try {
    const body = requestObject(await readRetailLocalJSON(request, 16_384));
    const release = await updateRetailLocalReleaseAsset(params.id, {
      status: body?.status,
      accessLevel: body?.accessLevel,
      isLatest: body?.isLatest,
      minOs: body?.minOs,
      releaseNotes: body?.releaseNotes,
    });
    return NextResponse.json({ release }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError || error instanceof RetailLocalRequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const PATCH = withRouteErrorLog("PATCH /api/admin/retail-local/releases/[id]", handlePATCH);

const PURGE_CONFIRMATION = "PURGE-RETAIL-LOCAL-RELEASE-FILE";

async function handleDELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  try {
    const body = requestObject(await readRetailLocalJSON(request, 1024));
    if (body.confirmation !== PURGE_CONFIRMATION || body.releaseId !== params.id) {
      return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
    }
    const result = await purgeRetailLocalReleaseFile({
      releaseId: params.id,
      // This is a global platform action. Keep its audit on the platform
      // administrator's home tenant, not a temporary drill-down tenant.
      tenantId: String(auth.admin.tenant_id || auth.tenantId),
      adminId: auth.adminId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError || error instanceof RetailLocalRequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const DELETE = withRouteErrorLog("DELETE /api/admin/retail-local/releases/[id]", handleDELETE);
