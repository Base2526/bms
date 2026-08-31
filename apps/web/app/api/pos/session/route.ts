// =============================================================
// GET /api/pos/session — เครื่องนี้คือใคร กะเปิดอยู่ไหม ใครขายได้บ้าง
// -------------------------------------------------------------
// auth: header `x-pos-device-token` — จอขายเรียกตอนเปิดเครื่องและตอนรีเฟรช
// tenant มาจากตัวเครื่อง client บอกไม่ได้
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  getOpenPosShift,
  getPosShiftReturnSummary,
  listPosCashiers,
  listPosPurchaseReceivers, listPosApprovers,
} from "@/lib/bms/pos";
import { getLocation } from "@/lib/bms/locations";
import { getStoreProfile } from "@/lib/bms/storeProfile";
import { getVatSettings } from "@/lib/bms/taxDocuments";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const [shift, location, cashiers, purchaseReceivers, approvers, vat, store] = await Promise.all([
    getOpenPosShift(device.tenantId, device.id),
    getLocation(device.tenantId, device.locationId),
    listPosCashiers(device.tenantId),
    listPosPurchaseReceivers(device.tenantId),
    listPosApprovers(device.tenantId),
    getVatSettings(device.tenantId),
    // เลขผู้เสียภาษีของร้าน — ใบกำกับภาษีอย่างย่อต้องมี ไม่ใช่ข้อมูลรายบิล
    // จึงส่งมากับ session แล้วจอขายใช้ซ้ำได้ทุกใบ (มี cache อยู่แล้วใน storeProfile)
    getStoreProfile(device.tenantId),
  ]);
  const shiftReturnSummary = shift
    ? await getPosShiftReturnSummary(device.tenantId, device.id, shift.id)
    : { returnCount: 0, returnTotal: 0, settledTotal: 0, pendingTotal: 0, pendingCount: 0 };

  return NextResponse.json({
    device: {
      id: device.id,
      code: device.code,
      name: device.name,
      registeredPosNo: device.registeredPosNo,
      scanner: {
        mode: device.scannerMode,
        prefixKey: device.scannerPrefixKey,
        suffixKey: device.scannerSuffixKey,
        maxGapMs: device.scannerMaxGapMs,
      },
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
    shiftReturnSummary,
    cashiers,
    purchaseReceivers,
    // ใครกด PIN อนุมัติงานไหนได้ — จอกรอง dropdown จากชุดนี้ ไม่ใช่จากรายชื่อคนขาย
    approvers,
    store: { taxId: store.taxId, receiptLanguageMode: store.receiptLanguageMode },
    vat: {
      registered: vat.vatRegistered,
      priceIncludesVat: vat.priceIncludesVat,
      rate: vat.vatRate,
      calendarEra: vat.calendarEra,
      // จอต้องรู้กติกาปัดเศษ ไม่งั้นจะส่งยอดที่ server ไม่รับ (PAYMENT_MISMATCH)
      // แล้วบิลถูกยกเลิกทิ้งทั้งใบตอนมีลูกค้ายืนรออยู่
      cashRounding: vat.cashRounding,
    },
  });
}

export const GET = withRouteErrorLog("GET /api/pos/session", handleGET);
