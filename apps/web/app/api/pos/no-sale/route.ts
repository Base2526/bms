// =============================================================
// POST /api/pos/no-sale — เปิดลิ้นชักโดยไม่ขาย (8.0)
// -------------------------------------------------------------
// GET  รายการของกะนี้
// POST บันทึกการเปิด (ต้องมีเหตุผล + PIN คนที่เปิด)
//
// ไม่ต้องมีผู้อนุมัติ — แลกแบงก์ย่อยเป็นงานประจำ ถ้าบังคับหาหัวหน้าทุกครั้ง
// พนักงานจะใช้คันโยกฉุกเฉินใต้ลิ้นชักแทน แล้วไม่เหลือร่องรอยอะไรเลย
// การควบคุมอยู่ที่ "ทุกครั้งมีบันทึก" และตัวเลขที่โผล่บนสรุปกะ
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  listNoSales,
  recordNoSale,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ctx(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return { error: NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 }), device: null, shift: null };
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return { error: NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 }), device: null, shift: null };
  return { error: null, device, shift };
}

async function handleGET(req: NextRequest) {
  const c = await ctx(req);
  if (c.error) return c.error;
  return NextResponse.json({ noSales: await listNoSales(c.device.tenantId, c.shift.id) });
}

async function handlePOST(req: NextRequest) {
  const c = await ctx(req);
  if (c.error) return c.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });

  const auth = await verifyCashierPin(c.device.tenantId, cashierUserId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(c.device.tenantId, auth.userId, "pos.nosale"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(c.device.tenantId, "pos.nosale") }, { status: 403 });
  }

  const result = await recordNoSale({
    tenantId: c.device.tenantId,
    deviceId: c.device.id,
    shiftId: c.shift.id,
    actorUserId: auth.userId,
    reason: typeof body.reason === "string" ? body.reason : "",
  });
  const status = result.status === "RECORDED" ? 200 : result.status === "SHIFT_NOT_OPEN" ? 409 : 400;
  return NextResponse.json(result, { status });
}

export const GET = withRouteErrorLog("GET /api/pos/no-sale", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/no-sale", handlePOST);
