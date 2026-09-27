import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  DeliveryProviderSettingError,
  listDeliveryProviderSettings,
  saveDeliveryProviderSetting,
} from "@/lib/bms/deliveryProviderSettings";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  return NextResponse.json(
    { settings: await listDeliveryProviderSettings() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handlePOST(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  try {
    const setting = await saveDeliveryProviderSetting({
      actorUserId: String(auth.adminId),
      provider: body.provider,
      environment: body.environment,
      onboardingStatus: body.onboardingStatus ?? "DRAFT",
      credentialAuthority: body.credentialAuthority ?? "UNCONFIRMED",
      authenticationMode: body.authenticationMode ?? "UNCONFIRMED",
      tenantConnectionsEnabled: body.tenantConnectionsEnabled === true,
      partnerId: body.partnerId, clientId: body.clientId, clientSecret: body.clientSecret,
      accessToken: body.accessToken, refreshToken: body.refreshToken,
      webhookSecret: body.webhookSecret, apiBaseUrl: body.apiBaseUrl,
      apiVersion: body.apiVersion, webhookAuthHeader: body.webhookAuthHeader,
      contractUrl: body.contractUrl, contractVersion: body.contractVersion,
      contractReviewedAt: body.contractReviewedAt, credentialExpiresAt: body.credentialExpiresAt,
      config: body.config,
    });
    return NextResponse.json({ setting });
  } catch (error) {
    if (error instanceof DeliveryProviderSettingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/admin/delivery-providers", handleGET);
export const POST = withRouteErrorLog("POST /api/admin/delivery-providers", handlePOST);
