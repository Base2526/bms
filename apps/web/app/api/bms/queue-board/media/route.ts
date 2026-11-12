import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getQueueBoardMedia, QueueBoardMediaError, saveQueueBoardMedia, type QueueBoardMediaInput } from "@/lib/bms/queueBoardMedia";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("location.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  if (!UUID.test(locationId)) return NextResponse.json({ error: "รหัสสาขาไม่ถูกต้อง" }, { status: 400 });
  try {
    const settings = await getQueueBoardMedia(auth.tenantId, locationId, String(auth.adminId));
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as Error).message === "FORBIDDEN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof QueueBoardMediaError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("location.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const locationId = body?.locationId;
  if (typeof locationId !== "string" || !UUID.test(locationId)) return NextResponse.json({ error: "รหัสสาขาไม่ถูกต้อง" }, { status: 400 });
  try {
    const settings = await saveQueueBoardMedia(auth.tenantId, locationId, String(auth.adminId), body.settings as QueueBoardMediaInput);
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as Error).message === "FORBIDDEN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof QueueBoardMediaError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/bms/queue-board/media", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/queue-board/media", handlePOST);
