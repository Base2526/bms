// =============================================================
// GET  /api/pos/member?q=...            ค้นสมาชิกที่เคาน์เตอร์
// POST /api/pos/member                  สมัครสมาชิกใหม่ / ผูกเลขสมาชิกกับลูกค้าเดิม
// -------------------------------------------------------------
// auth: header `x-pos-device-token` เหมือน route POS อื่น — tenant มาจากตัวเครื่อง
// เท่านั้น ห้ามให้ client บอกว่าตัวเองเป็นร้านไหน
//
// สมัครสมาชิกต้องผ่าน PIN + permission `member.manage` เหมือนการขาย เพราะสร้าง
// ลูกค้าใหม่ในระบบ CRM ได้ (ร้านนี้ห้าม hard delete ลูกค้า — ข้อมูลขยะลบไม่ได้)
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, cashierHasPermission, getOpenPosShift, verifyCashierPin } from "@/lib/bms/pos";
import { enrollMember, searchMembers, toPosMemberSummary } from "@/lib/bms/membership";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3) {
    // กันการไล่ดูรายชื่อลูกค้าทั้งร้านจากจอขาย — ต้องรู้เบอร์/ชื่อบางส่วนก่อน
    return NextResponse.json({ members: [] }, { status: 200 });
  }
  const members = await searchMembers(device.tenantId, q, 10);
  return NextResponse.json({ members: members.map(toPosMemberSummary) }, { status: 200 });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!cashierUserId || !phone) return NextResponse.json({ error: "cashierUserId และ phone จำเป็น" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, typeof body.pin === "string" ? body.pin : "");
  if (!auth.ok) {
    return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  }
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "member.manage"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "member.manage") }, { status: 403 });
  }

  const openShift = await getOpenPosShift(device.tenantId, device.id);
  const result = await enrollMember(device.tenantId, {
    phone,
    name: typeof body.name === "string" ? body.name : null,
    actorUserId: auth.userId,
    enrollmentChannel: "POS",
    enrolledLocationId: device.locationId,
    enrolledPosDeviceId: device.id,
    enrolledShiftId: openShift?.id ?? null,
  });
  return NextResponse.json(
    result.status === "INVALID" ? result : { ...result, member: toPosMemberSummary(result.member) },
    { status: result.status === "INVALID" ? 400 : 200 }
  );
}

export const GET = withRouteErrorLog("GET /api/pos/member", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/member", handlePOST);
