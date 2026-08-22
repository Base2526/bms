// =============================================================
// /api/pos/park — พักบิลไว้ระหว่างรอลูกค้า แล้วเรียกกลับมาขายต่อ
// -------------------------------------------------------------
// GET    รายการบิลพักของกะนี้
// POST   {action:"park"}   พักตะกร้าปัจจุบัน
//        {action:"resume"} เรียกกลับมา (อ่านแล้วลบในคำสั่งเดียว)
//        {action:"drop"}   ทิ้งไปเลย
//
// ไม่ต้องใช้ PIN: การพักบิลไม่แตะเงิน ไม่แตะสต็อก และไม่สร้างเอกสารอะไรเลย
// บังคับ PIN ตรงนี้จะได้แค่แคชเชียร์ที่เลิกพักบิลแล้วกลับไปจดใส่กระดาษเหมือนเดิม
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  deleteParkedSale,
  getOpenPosShift,
  listParkedSales,
  parkSale,
  resumeParkedSale,
} from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireShift(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return { error: NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 }), device: null, shift: null };
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return { error: NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 }), device: null, shift: null };
  return { error: null, device, shift };
}

async function handleGET(req: NextRequest) {
  const ctx = await requireShift(req);
  if (ctx.error) return ctx.error;
  return NextResponse.json({ parked: await listParkedSales(ctx.device.tenantId, ctx.shift.id) });
}

async function handlePOST(req: NextRequest) {
  const ctx = await requireShift(req);
  if (ctx.error) return ctx.error;
  const { device, shift } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "park");

  if (action === "park") {
    const parkedBy = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
    if (!parkedBy) return NextResponse.json({ error: "ต้องระบุพนักงาน" }, { status: 400 });
    const result = await parkSale({
      tenantId: device.tenantId,
      deviceId: device.id,
      shiftId: shift.id,
      parkedBy,
      label: typeof body.label === "string" ? body.label : "",
      cart: body.cart,
      itemCount: Number(body.itemCount ?? 0),
      subtotalHint: Number(body.subtotalHint ?? 0),
    });
    const status = result.status === "PARKED" ? 200
      : result.status === "SHIFT_NOT_OPEN" ? 409
      : result.status === "TOO_MANY" ? 409
      : 400;
    return NextResponse.json(result, { status });
  }

  const parkedId = typeof body.parkedId === "string" ? body.parkedId.trim() : "";
  if (!parkedId) return NextResponse.json({ error: "ต้องระบุบิลที่พักไว้" }, { status: 400 });

  if (action === "resume") {
    const result = await resumeParkedSale(device.tenantId, shift.id, parkedId);
    return NextResponse.json(result, { status: result.status === "RESUMED" ? 200 : 404 });
  }
  if (action === "drop") {
    const ok = await deleteParkedSale(device.tenantId, shift.id, parkedId);
    return NextResponse.json({ status: ok ? "DROPPED" : "NOT_FOUND" }, { status: ok ? 200 : 404 });
  }
  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/park", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/park", handlePOST);
