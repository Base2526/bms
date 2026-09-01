import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { sendSupportBundle } from "@/lib/bms/supportDiagnostics";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("support.logs.send");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const limit = await rateLimit(`support-send:${auth.tenantId}:${auth.adminId}`, 3, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many diagnostic sends", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }
  const body = await req.json().catch(() => ({}));
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "explicit confirmation required" }, { status: 400 });
  }
  const description = String(body?.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const result = await sendSupportBundle({
    tenantId: auth.tenantId,
    actorId: String(auth.adminId),
    actorEmail: String(auth.admin.email ?? "support-request@invalid.local"),
    description,
    from: typeof body.from === "string" ? body.from : null,
    to: typeof body.to === "string" ? body.to : null,
  });
  return NextResponse.json(result, { status: 201 });
}

export const POST = withRouteErrorLog("POST /api/bms/support-diagnostics/send", handlePOST);
