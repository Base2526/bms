import { NextResponse, type NextRequest } from "next/server";

import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listManagedRuntimeReleases,
  deleteManagedRuntimeRelease,
  ManagedRuntimeReleaseError,
  managedRuntimeReleaseBaseUrl,
  managedRuntimeReleaseReadiness,
} from "@/lib/bms/managedRuntimeReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const readiness = managedRuntimeReleaseReadiness();
  const releases = await listManagedRuntimeReleases();
  return NextResponse.json({ releases, baseUrl: managedRuntimeReleaseBaseUrl(), readiness }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/runtime-releases", handleGET);

async function handleDELETE(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const firstHeader = (value: string | null) => (value || "").split(",", 1)[0].trim();
  const origin = firstHeader(request.headers.get("origin"));
  const host = firstHeader(request.headers.get("x-forwarded-host")) || firstHeader(request.headers.get("host"));
  const protocol = firstHeader(request.headers.get("x-forwarded-proto")) || new URL(request.url).protocol.slice(0, -1);
  if (!origin || !host || !["http", "https"].includes(protocol)
    || origin !== `${protocol}://${host}`) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { releaseVersion, platformTarget } = body as Record<string, unknown>;
  if (typeof releaseVersion !== "string" || typeof platformTarget !== "string") {
    return NextResponse.json({ error: "invalid_release" }, { status: 400 });
  }
  try {
    await deleteManagedRuntimeRelease(releaseVersion, platformTarget);
    console.info("[retail-local] managed runtime release deleted", {
      adminId: String(auth.adminId), releaseVersion, platformTarget,
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ManagedRuntimeReleaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const DELETE = withRouteErrorLog("DELETE /api/admin/retail-local/runtime-releases", handleDELETE);
