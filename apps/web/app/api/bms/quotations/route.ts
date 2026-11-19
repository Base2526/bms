import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { createQuoteDraft, listQuotes, type QuoteDraftInput } from "@/lib/bms/salesQuotations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("quotation.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return NextResponse.json({ quotes: await listQuotes(auth.tenantId, String(auth.adminId), limit) });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("quotation.create");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const body = await req.json().catch(() => null) as QuoteDraftInput | null;
  if (!body || typeof body !== "object") return NextResponse.json({ status: "INVALID_INPUT" }, { status: 400 });
  const result = await createQuoteDraft(auth.tenantId, String(auth.adminId), body);
  return NextResponse.json(result, { status: result.status === "DRAFT" ? 200
    : result.status === "BRANCH_FORBIDDEN" ? 403
    : result.status === "CUSTOMER_NOT_FOUND" ? 404
    : result.status === "IDEMPOTENCY_CONFLICT" ? 409 : 400 });
}

export const GET = withRouteErrorLog("GET /api/bms/quotations", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/quotations", handlePOST);
