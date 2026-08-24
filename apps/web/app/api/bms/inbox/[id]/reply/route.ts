// POST /api/bms/inbox/:id/reply — staff ตอบเอง (persist + ยิงกลับช่องทาง)  [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sendStaffMessage } from "@/lib/bms/inbox";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("inbox.reply");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "conversation id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const result = await sendStaffMessage(auth.tenantId, id, text, null);
  const httpStatus = result.status === "SENT" ? 200 : result.status === "NOT_FOUND" ? 404 : 400;
  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/inbox/[id]/reply", handlePOST);
