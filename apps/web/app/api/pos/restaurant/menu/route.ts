import { NextResponse, type NextRequest } from "next/server";
import { listRestaurantMenu } from "@/lib/bms/restaurantPos";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantRead } from "../routeAuth";

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
