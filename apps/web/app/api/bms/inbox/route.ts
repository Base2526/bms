// GET /api/bms/inbox — list conversations   [Phase 1: default tenant]
//   ?status=OPEN&assignedTo=<staff user id>&tag=&search=&limit=&offset=
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listConversations } from "@/lib/bms/inbox";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rows = await listConversations(DEFAULT_TENANT_ID, {
    status: url.searchParams.get("status"),
    assignedTo: url.searchParams.get("assignedTo"),
    tag: url.searchParams.get("tag"),
    search: url.searchParams.get("search"),
    limit: Number(url.searchParams.get("limit")) || 50,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ conversations: rows });
}
