// GET /api/bms/inbox — list conversations   [signed admin + RBAC · tenant จาก session]
//   ?status=OPEN&assignedTo=<staff user id>&tag=&search=&limit=&offset=
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listConversations } from "@/lib/bms/inbox";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("inbox.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const url = new URL(req.url);
  const rows = await listConversations(auth.tenantId, {
    status: url.searchParams.get("status"),
    assignedTo: url.searchParams.get("assignedTo"),
    tag: url.searchParams.get("tag"),
    search: url.searchParams.get("search"),
    limit: Number(url.searchParams.get("limit")) || 50,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ conversations: rows });
}

export const GET = withRouteErrorLog("GET /api/bms/inbox", handleGET);
