import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listDeliveryIntegrations, testDeliveryIntegration, upsertDeliveryIntegration } from "@/lib/bms/deliveryIntegrations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleGET() {
  const auth = await authorizeAdminRoute("delivery.integration.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  return NextResponse.json({ integrations: await listDeliveryIntegrations(auth.tenantId) });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.integration.manage");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  try {
    if (body.action === "test") {
      const integrationId = typeof body.integrationId === "string" ? body.integrationId.trim() : "";
      if (!UUID_RE.test(integrationId)) return NextResponse.json({ error: "INVALID_INTEGRATION" }, { status: 400 });
      const result = await testDeliveryIntegration(auth.tenantId, integrationId);
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    const saved = await upsertDeliveryIntegration({
      tenantId: auth.tenantId,
      actorUserId: String(auth.adminId),
      id: typeof body.id === "string" ? body.id.trim() : null,
      provider: body.provider,
      environment: body.environment,
      rolloutMode: body.rolloutMode ?? "OFF",
      active: body.active === true,
      outboundCommandsEnabled: body.outboundCommandsEnabled === true,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      webhookSecret: body.webhookSecret,
      config: body.config,
      apiVersion: body.apiVersion,
      credentialExpiresAt: body.credentialExpiresAt,
    });
    return NextResponse.json(saved);
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_INTEGRATION_INVALID";
    const status = code.includes("NOT_FOUND") ? 404 : code.includes("IMMUTABLE") || code.includes("REQUIRED") ? 409 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/integrations", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/delivery/integrations", handlePOST);
