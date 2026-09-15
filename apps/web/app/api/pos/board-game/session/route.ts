import { NextRequest, NextResponse } from "next/server";
import { getBoardGameCheckoutForPos } from "@/lib/bms/boardGameCafe";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }
  // `id` = กลุ่มบิล (`9.89`) ไม่ใช่ session — โต๊ะที่แยกกลุ่มมีบิลรออยู่หลายใบพร้อมกัน
  const billingGroupId = req.nextUrl.searchParams.get("id")?.trim();
  if (!billingGroupId) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const checkout = await getBoardGameCheckoutForPos(device.tenantId, device.locationId, billingGroupId);
    return NextResponse.json({ checkout });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดบิลเวลาเล่นไม่สำเร็จ" },
      { status: 404 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/pos/board-game/session", handleGET);
