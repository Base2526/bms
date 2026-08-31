import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  listPosShiftHistory,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { cashierUserId?: unknown; pin?: unknown };
  const userId = typeof body.cashierUserId === "string" ? body.cashierUserId : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.shift.report"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "pos.shift.report") }, { status: 403 });
  }

  const shifts = await listPosShiftHistory(device.tenantId, device.id, 12);
  return NextResponse.json({ shifts });
}

export const POST = withRouteErrorLog("POST /api/pos/shifts", handlePOST);
