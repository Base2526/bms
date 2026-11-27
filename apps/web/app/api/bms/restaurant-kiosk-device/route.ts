import { NextResponse, type NextRequest } from "next/server";
import { checkRestaurantKioskRateLimit } from "@/lib/bms/restaurantKioskEdge";
import { readRestaurantKioskJson } from "@/lib/bms/restaurantKioskRequestBody";
import {
  kioskDesktopDeviceStatus, validateKioskDesktopBinding, verifyKioskDesktopPin,
} from "@/lib/bms/restaurantKioskDevices";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function admission(credential: string, action: string, ceiling: number) {
  const result = await checkRestaurantKioskRateLimit(credential, `device:${action}`, ceiling);
  return result.status === 200 ? null : NextResponse.json({
    code: result.status === 503 ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
    error: result.status === 503 ? "ตรวจการจำกัดคำขอไม่ได้ กรุณาติดต่อพนักงาน"
      : "ส่งคำขอถี่เกินไป กรุณารอแล้วลองใหม่",
  },
    { status: result.status, headers: { "retry-after": String(result.retryAfter) } });
}

async function handleGET(req: NextRequest) {
  const credential = req.headers.get("x-kiosk-device-token") ?? "";
  const blocked = await admission(credential, "status", 60);
  if (blocked) return blocked;
  try {
    const status = await kioskDesktopDeviceStatus(credential);
    return status ? NextResponse.json(status, { headers: { "cache-control": "no-store" } })
      : NextResponse.json({ error: "เครื่องไม่พร้อมใช้งาน" }, { status: 401 });
  } catch { return NextResponse.json({ error: "ตรวจสถานะเครื่องไม่ได้" }, { status: 503 }); }
}

async function handlePOST(req: NextRequest) {
  const credential = req.headers.get("x-kiosk-device-token") ?? "";
  const preflight = await admission(credential, "post", 12);
  if (preflight) return preflight;
  let body: Record<string, unknown>;
  try { body = await readRestaurantKioskJson(req); }
  catch (error) { return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" },
    { status: error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400 }); }
  const action = body.action;
  const blocked = await admission(credential, String(action), action === "verifyPin" ? 8 : 20);
  if (blocked) return blocked;
  try {
    if (action === "bind") {
      const result = await validateKioskDesktopBinding(credential,
        typeof body.publicToken === "string" ? body.publicToken : "",
        typeof body.pinVersion === "string" ? body.pinVersion : "");
      if (!result) return NextResponse.json({ code: "BINDING", error: "ตรวจเครื่องและ URL ไม่ผ่าน" }, { status: 409 });
      if (result.status !== "OK") {
        const error = result.status === "WRONG_BRANCH" ? "URL นี้เป็นของสาขาอื่น กรุณาตรวจสาขาก่อนติดตั้ง"
          : result.status === "PIN_CHANGED" ? "PIN ดูแลจอถูกเปลี่ยน กรุณาปลดล็อกใหม่"
            : result.status === "NO_PIN" ? "ยังไม่ได้ตั้ง PIN ดูแลจอ"
              : "URL นี้ถูกปิดหรือหมุนแล้ว กรุณาขอ URL ใหม่";
        return NextResponse.json({ code: result.status, error },
          { status: result.status === "URL_UNAVAILABLE" ? 410 : 409 });
      }
      return NextResponse.json({ storeName: result.storeName, locationName: result.locationName },
        { headers: { "cache-control": "no-store" } });
    }
    if (action === "verifyPin") {
      const result = await verifyKioskDesktopPin(credential,
        typeof body.pin === "string" ? body.pin : "");
      return NextResponse.json(result, { status: result.status === "OK" ? 200
        : result.status === "UNAUTHORIZED" ? 401 : result.status === "LOCKED" ? 423 : 403,
        headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  } catch { return NextResponse.json({ error: "ตรวจเครื่อง Kiosk ไม่สำเร็จ" }, { status: 503 }); }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-kiosk-device", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/restaurant-kiosk-device", handlePOST);
