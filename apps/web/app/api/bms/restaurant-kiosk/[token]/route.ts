import { NextResponse, type NextRequest } from "next/server";
import { checkRestaurantKioskRateLimit } from "@/lib/bms/restaurantKioskEdge";
import {
  restaurantKioskMenu, restaurantKioskMenuItem, restaurantKioskSubmissionStatus,
  submitRestaurantKioskOrder,
} from "@/lib/bms/restaurantKiosk";
import { publicErrorMessage } from "@/lib/publicErrorMessage";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readRestaurantKioskJson } from "@/lib/bms/restaurantKioskRequestBody";
import { RestaurantCheckError } from "@/lib/bms/restaurantPosErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };

async function limited(token: string, action: string, ceiling: number) {
  const result = await checkRestaurantKioskRateLimit(token, action, ceiling);
  if (result.status === 200) return null;
  return NextResponse.json({ code: result.status === 503 ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
    error: result.status === 503
    ? "จอสั่งอาหารขัดข้องชั่วคราว กรุณาติดต่อพนักงาน"
    : "กรุณารอสักครู่แล้วลองใหม่" },
    { status: result.status, headers: { "retry-after": String(result.retryAfter) } });
}

async function handleGET(req: NextRequest, { params }: RouteContext) {
  const token = (await params).token;
  const submissionId = req.nextUrl.searchParams.get("submissionId");
  const block = await limited(token, submissionId ? "status" : "menu", 60);
  if (block) return block;
  try {
    return NextResponse.json(submissionId
      ? await restaurantKioskSubmissionStatus(token, submissionId)
      : await restaurantKioskMenu(token));
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "จอสั่งอาหารไม่พร้อมใช้งาน") },
      { status: error instanceof RestaurantCheckError && error.code === "KIOSK_UNAVAILABLE" ? 410 : 409 });
  }
}

async function handlePOST(req: NextRequest, { params }: RouteContext) {
  const token = (await params).token;
  // Rate-limit before consuming an untrusted body; the streaming cap also works without Content-Length.
  const preflight = await limited(token, "post", 60);
  if (preflight) return preflight;
  let body: Record<string, unknown>;
  try { body = await readRestaurantKioskJson(req); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "BODY_TOO_LARGE"
      ? "คำขอใหญ่เกิน 32 KiB" : "ข้อมูลคำขอไม่ถูกต้อง" },
      { status: error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400 });
  }
  const action = body.action === "detail" ? "detail" : "submit";
  const block = await limited(token, action, action === "detail" ? 60 : 10);
  if (block) return block;
  try {
    if (action === "detail") {
      return NextResponse.json(await restaurantKioskMenuItem({
        token, sku: typeof body.sku === "string" ? body.sku.trim() : "",
        size: typeof body.size === "string" ? body.size : null,
        packCode: typeof body.packCode === "string" ? body.packCode : null,
      }));
    }
    const result = await submitRestaurantKioskOrder({
      token, serviceMode: body.serviceMode,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      items: Array.isArray(body.items) ? body.items as any[] : [],
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "ส่งคำขอไม่สำเร็จ กรุณาติดต่อพนักงาน") },
      { status: error instanceof RestaurantCheckError && error.code === "KIOSK_UNAVAILABLE" ? 410 : 409 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-kiosk/[token]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/restaurant-kiosk/[token]", handlePOST);
