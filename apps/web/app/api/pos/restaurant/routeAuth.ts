import type { NextRequest } from "next/server";
import { authenticatePosDevice, cashierHasPermission, getOpenPosShift, verifyCashierPin } from "@/lib/bms/pos";

export async function authenticateRestaurantRead(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return { ok: false as const, status: 401, error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" };
  return { ok: true as const, device };
}

export async function authenticateRestaurantMutation(
  req: NextRequest,
  body: Record<string, unknown>,
  permission: string
) {
  const read = await authenticateRestaurantRead(req);
  if (!read.ok) return read;
  const userId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.cashierPin === "string" ? body.cashierPin : "";
  if (!userId || !pin) return { ok: false as const, status: 400, error: "ต้องระบุพนักงานและ PIN" };
  const actor = await verifyCashierPin(read.device.tenantId, userId, pin);
  if (!actor.ok) {
    const error = actor.reason === "NO_PIN" ? "พนักงานยังไม่ได้ตั้ง PIN"
      : actor.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return { ok: false as const, status: 403, error };
  }
  if (!(await cashierHasPermission(read.device.tenantId, actor.userId, permission))) {
    return { ok: false as const, status: 403, error: `ไม่มีสิทธิ์ ${permission}` };
  }
  const shift = await getOpenPosShift(read.device.tenantId, read.device.id);
  if (!shift) return { ok: false as const, status: 409, error: "ต้องเปิดกะของเครื่องนี้ก่อน" };
  return { ok: true as const, device: read.device, shift, actor };
}
