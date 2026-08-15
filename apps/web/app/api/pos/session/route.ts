// =============================================================
// GET /api/pos/session — เครื่องนี้คือใคร กะเปิดอยู่ไหม ใครขายได้บ้าง
// -------------------------------------------------------------
// auth: header `x-pos-device-token` — จอขายเรียกตอนเปิดเครื่องและตอนรีเฟรช
// tenant มาจากตัวเครื่อง client บอกไม่ได้
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, getOpenPosShift, listPosCashiers } from "@/lib/bms/pos";
import { getLocation } from "@/lib/bms/locations";
import { getVatSettings } from "@/lib/bms/taxDocuments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const [shift, location, cashiers, vat] = await Promise.all([
    getOpenPosShift(device.tenantId, device.id),
    getLocation(device.tenantId, device.locationId),
    listPosCashiers(device.tenantId),
    getVatSettings(device.tenantId),
  ]);

  return NextResponse.json({
    device: {
      id: device.id,
      code: device.code,
      name: device.name,
      registeredPosNo: device.registeredPosNo,
    },
    location: location
      ? {
          id: location.id,
          name: location.name,
          branchCode: location.branchCode,
          vatCode: location.vatCode,
          pharmacistName: location.pharmacistName,
        }
      : null,
    shift,
    cashiers,
    vat: {
      registered: vat.vatRegistered,
      priceIncludesVat: vat.priceIncludesVat,
      rate: vat.vatRate,
      calendarEra: vat.calendarEra,
    },
  });
}
