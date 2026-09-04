import { NextResponse, type NextRequest } from "next/server";
import { listRestaurantMenu } from "@/lib/bms/restaurantPos";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantRead } from "../routeAuth";
import { authenticateRestaurantMutation } from "../routeAuth";
import { setMenuTemporarilyUnavailable } from "@/lib/bms/menuAvailability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// รายการเมนูทั้งหมดของสาขาไว้เรนเดอร์เป็นกริดที่หน้าสั่งอาหาร — โหลดครั้งเดียวต่อ
// การเปิดหน้า ไม่ต้องพิมพ์ค้นหาก่อนเห็นเมนู (ต่างจาก /api/pos/search ที่ต้องมี q)
async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const items = await listRestaurantMenu(auth.device.tenantId, auth.device.locationId);
  return NextResponse.json({ items });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/menu", handleGET);

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const productSku = typeof body.productSku === "string" ? body.productSku.trim() : "";
  if (!productSku || typeof body.unavailable !== "boolean") {
    return NextResponse.json({ error: "ต้องระบุเมนูและสถานะหมดวันนี้" }, { status: 400 });
  }
  const result = await setMenuTemporarilyUnavailable({
    tenantId: auth.device.tenantId,
    locationId: auth.device.locationId,
    productSku,
    unavailable: body.unavailable,
    actorUserId: auth.actor.userId,
    reason: typeof body.reason === "string" ? body.reason : null,
  });
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/pos/restaurant/menu", handlePOST);
