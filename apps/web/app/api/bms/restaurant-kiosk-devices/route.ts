import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { userCanAccessLocation } from "@/lib/bms/locations";
import {
  issueKioskDesktopDevice, listKioskDesktopDevices, manageKioskDesktopDevice,
} from "@/lib/bms/restaurantKioskDevices";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readRestaurantKioskJson } from "@/lib/bms/restaurantKioskRequestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authorizeBranch(locationId: string) {
  const auth = await authorizeAdminRoute("restaurant.floor.manage");
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: auth.status }) };
  if (!UUID.test(locationId) || !await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
    return { ok: false as const, response: NextResponse.json({ error: "ไม่มีสิทธิ์จัดการสาขานี้" }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

async function handleGET(req: NextRequest) {
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  const access = await authorizeBranch(locationId);
  if (!access.ok) return access.response;
  try {
    return NextResponse.json({ devices: await listKioskDesktopDevices(access.auth.tenantId, locationId) },
      { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "อ่านรายการเครื่อง Kiosk ไม่สำเร็จ" }, { status: 503 });
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("restaurant.floor.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  let body: Record<string, unknown>;
  try { body = await readRestaurantKioskJson(req); }
  catch (error) { return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" },
    { status: error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400 }); }
  const locationId = typeof body.locationId === "string" ? body.locationId : "";
  if (!UUID.test(locationId) || !await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการสาขานี้" }, { status: 403 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "ต้องยืนยันการเปลี่ยนแปลง" }, { status: 400 });
  }
  const action = body.action;
  try {
    if (action === "issue") {
      return NextResponse.json(await issueKioskDesktopDevice({
        tenantId: auth.tenantId, locationId, actorUserId: String(auth.adminId),
        label: typeof body.label === "string" ? body.label : "",
      }), { headers: { "cache-control": "no-store" } });
    }
    if (!["setPin", "resetPin", "clearPin", "rotateCredential", "revoke"].includes(String(action))) {
      return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
    }
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    if (!UUID.test(deviceId)) return NextResponse.json({ error: "เครื่องไม่ถูกต้อง" }, { status: 400 });
    return NextResponse.json(await manageKioskDesktopDevice({
      tenantId: auth.tenantId, locationId, deviceId,
      actorUserId: String(auth.adminId),
      action: action as "setPin" | "resetPin" | "clearPin" | "rotateCredential" | "revoke",
      pin: typeof body.pin === "string" ? body.pin : undefined,
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const known = error instanceof Error && [
      "ชื่อเครื่องต้องยาว 1–80 ตัวอักษร", "PIN ดูแลจอต้องเป็นตัวเลข 6–8 หลัก", "PIN ใหม่ต้องไม่ซ้ำ PIN เดิม",
      "ไม่พบสาขาที่เปิดใช้งาน", "สาขานี้มีเครื่อง Kiosk ที่เปิดใช้งานแล้ว",
      "ไม่พบเครื่อง Kiosk ในสาขานี้", "เครื่อง Kiosk ถูกเพิกถอนแล้ว",
    ].includes(error.message);
    return NextResponse.json({ error: known ? (error as Error).message : "จัดการเครื่อง Kiosk ไม่สำเร็จ" },
      { status: known ? 409 : 503 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-kiosk-devices", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/restaurant-kiosk-devices", handlePOST);
