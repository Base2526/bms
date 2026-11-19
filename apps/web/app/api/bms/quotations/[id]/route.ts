import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getQuote, reviseQuote, transitionQuote, type QuoteDraftInput } from "@/lib/bms/salesQuotations";
import type { BmsPermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permissionByAction = {
  REVISE: "quotation.create", APPROVE: "quotation.approve", SEND: "quotation.send",
  ACCEPT: "quotation.accept", REJECT: "quotation.accept", CONVERT: "quotation.convert",
} as const satisfies Record<string, BmsPermission>;
type Action = keyof typeof permissionByAction;

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("quotation.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const quote = await getQuote(auth.tenantId, String(auth.adminId), params.id);
  return quote ? NextResponse.json({ quote }) : NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
}

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const baseAuth = await authorizeAdminRoute("quotation.view");
  if (!baseAuth.ok) return NextResponse.json({ error: baseAuth.status === 401 ? "unauthorized" : "forbidden" }, { status: baseAuth.status });
  const body = await req.json().catch(() => null) as { action?: unknown; confirm?: unknown;
    evidenceRef?: unknown; draft?: QuoteDraftInput } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(action in permissionByAction) || body?.confirm !== true) {
    return NextResponse.json({ status: "CONFIRMATION_REQUIRED" }, { status: 400 });
  }
  const auth = await authorizeAdminRoute(permissionByAction[action as Action]);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const result = action === "REVISE"
    ? await reviseQuote(auth.tenantId, String(auth.adminId), params.id, body?.draft as QuoteDraftInput)
    : await transitionQuote(auth.tenantId, String(auth.adminId), params.id, action as Exclude<Action, "REVISE">,
      typeof body?.evidenceRef === "string" ? body.evidenceRef : null);
  const status = ["DRAFT", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "CONVERTED"].includes(result.status) ? 200
    : result.status === "NOT_FOUND" ? 404
    : result.status === "BRANCH_FORBIDDEN" ? 403
    : ["INVALID_STATE", "IDEMPOTENCY_CONFLICT", "ORDER_REJECTED", "PRICE_MISMATCH", "EXPIRED"].includes(result.status) ? 409 : 400;
  return NextResponse.json(result, { status });
}

export const GET = withRouteErrorLog("GET /api/bms/quotations/[id]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/quotations/[id]", handlePOST);
