import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  getPosShiftExportData,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { getArShiftSummary } from "@/lib/bms/ar";
import { buildPosShiftWorkbook } from "@/lib/bms/posShiftExport";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return json("device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว", 401);

  const body = await req.json().catch(() => ({})) as {
    cashierUserId?: unknown;
    pin?: unknown;
    shiftId?: unknown;
  };
  const userId = typeof body.cashierUserId === "string" ? body.cashierUserId : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!userId || !pin) return json("ต้องระบุพนักงานและ PIN", 400);
  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) return json("PIN ไม่ถูกต้อง", 403);
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.shift.report"))) {
    return json("พนักงานคนนี้ไม่มีสิทธิ์ดาวน์โหลดรายละเอียดกะ", 403);
  }

  const requested = typeof body.shiftId === "string" && body.shiftId ? body.shiftId : null;
  const shiftId = requested ?? (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
  if (!shiftId) return json("ไม่พบกะ", 404);

  const data = await getPosShiftExportData(device.tenantId, shiftId, device.id);
  if (!data) return json("ไม่พบกะ", 404);
  const receivables = await getArShiftSummary(device.tenantId, shiftId);
  const workbook = buildPosShiftWorkbook(data, receivables);
  const opened = data.report.openedAt.slice(0, 10);
  const filename = `pos-shift-${data.report.deviceCode.replace(/[^a-zA-Z0-9_-]/g, "-")}-${opened}.xlsx`;

  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const POST = withRouteErrorLog("POST /api/pos/shift-report/export", handlePOST);
