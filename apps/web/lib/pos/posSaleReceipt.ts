// =============================================================
// ใบเสร็จขายของเครื่องขายเดสก์ท็อป — ประกอบจากบิลที่ server บันทึกแล้วเท่านั้น
// -------------------------------------------------------------
// ผลของ `bmsPosSale` มีแค่ยอดรวม/เงินทอน ไม่มีรายการ ส่วนลดแยกบรรทัด ใบกำกับ หรือ VAT
// ใบเสร็จที่ประกอบจากตะกร้าบนจอจึงเป็น "สูตรเงินชุดที่สอง" ซึ่ง drift ได้ (บทเรียนของ 9.22)
// ที่นี่อ่านแถวบิลจริงจาก `bmsPosLastSale` แล้วแปลงเป็น `ReceiptPayload` ก้อนเดียวกับที่
// `/pos` ป้อนให้ `<ReceiptPaper/>` และ `buildReceipt()` — **ห้ามคำนวณเงินในไฟล์นี้**
//
// โครงของ payload ต้องตามกิ่ง "ใบขาย" ของ `receiptPayloadOf()` ใน `/pos` บรรทัดต่อบรรทัด
// เพราะเป็นเอกสารชนิดเดียวกัน ออกจากเครื่องขายต่างรุ่นกันต้องได้กระดาษหน้าตาเดียวกัน
// =============================================================

import type { ReceiptPayload } from "./escpos";
import {
  posPaymentMethodLabel,
  receiptDocumentTitle,
  receiptLabel,
  receiptLocale,
  type ReceiptLanguageMode,
} from "./receiptI18n";

export type PosSaleReceiptRow = {
  orderId: string;
  receiptNo: string | null;
  billNo: string | null;
  docNo: string | null;
  soldAt: string;
  total: number;
  cashierName: string | null;
  branchCode: string | null;
  locationName: string | null;
  posLabel: string | null;
  posDeviceId: string | null;
  shiftId: string | null;
  saleLocationId: string | null;
  roundingAmount: number | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  cashTendered: number | null;
  cashChange: number | null;
  memberName: string | null;
  memberNo: string | null;
  lines: Array<{ receiptName: string; size: string | null; packQty: number; packPrice: number }>;
  payments: Array<{
    method: string;
    amount: number;
    ref: string | null;
    cashTendered: number | null;
    cashChange: number | null;
  }>;
  discountLines: Array<{ label: string; amount: number }>;
  vat: {
    rate: number;
    vatAmount: number;
    netBeforeVat: number;
    exemptAmount: number;
    roundingAmount: number;
  } | null;
};

export type PosSaleReceiptStore = {
  languageMode: ReceiptLanguageMode;
  vatRegistered: boolean;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  fallbackStoreName: string | null;
  fallbackBranchCode: string | null;
  fallbackPosNo: string | null;
};

/** แต้มของบิลนี้มาจากผลการขาย (บิลยังไม่ถูกอ่านกลับมาพร้อมแต้ม) — null = ไม่ผูกสมาชิก */
export type PosSaleReceiptPoints = {
  pointsEarned: number | null;
  pointsBalance: number | null;
} | null;

export function receiptPayloadFromPosSale(
  row: PosSaleReceiptRow,
  store: PosSaleReceiptStore,
  points: PosSaleReceiptPoints = null,
): ReceiptPayload {
  const mode = store.languageMode;
  const text = (thai: string, english: string) => receiptLabel(mode, thai, english);
  const at = new Date(row.soldAt);
  const payments = row.payments.length > 0
    ? row.payments
    : [{
        method: row.paymentMethod ?? "CASH",
        amount: row.total,
        ref: row.paymentRef,
        cashTendered: row.cashTendered,
        cashChange: row.cashChange,
      }];
  const lines = row.lines.map((line) => ({
    name: line.receiptName + (line.size && line.size !== "-" ? ` (${line.size})` : ""),
    qty: line.packQty,
    amount: line.packPrice * line.packQty,
  }));
  const rounding = Number(row.roundingAmount ?? row.vat?.roundingAmount ?? 0);
  return {
    languageMode: mode,
    storeName: row.locationName ?? store.fallbackStoreName ?? "",
    storeAddress: store.address,
    storePhone: store.phone,
    storeLogoUrl: store.logoUrl,
    locationId: row.saleLocationId,
    branchCode: row.branchCode ?? store.fallbackBranchCode,
    taxId: store.taxId,
    posDeviceId: row.posDeviceId,
    posNo: row.posLabel ?? store.fallbackPosNo,
    shiftId: row.shiftId,
    vatIncluded: store.vatRegistered,
    docTitle: receiptDocumentTitle(mode, "sale", store.vatRegistered),
    docNo: row.docNo,
    orderId: row.orderId,
    relatedDocNo: null,
    referenceDocNo: null,
    barcodeValue: row.billNo ?? row.receiptNo ?? row.docNo,
    at: Number.isNaN(at.getTime()) ? row.soldAt : at.toLocaleString(receiptLocale(mode)),
    cashier: row.cashierName,
    billNo: row.billNo ?? row.receiptNo ?? row.docNo ?? "—",
    notes: row.discountLines.length > 0
      ? [text(
          "ราคาสินค้าเป็นราคาป้าย ณ ตอนขาย ส่วนลดแสดงแยกด้านล่าง",
          "Items show the sale-time list price; discounts appear below",
        )]
      : null,
    returnReason: null,
    roundingAmount: rounding,
    refundLines: null,
    payments: payments.map((payment) => ({
      label: posPaymentMethodLabel(payment.method, mode),
      amount: payment.amount,
      ref: payment.ref,
      tendered: payment.cashTendered,
      change: payment.cashChange,
    })),
    lines,
    itemCount: row.lines.reduce((sum, line) => sum + line.packQty, 0),
    total: row.total,
    tendered: row.cashTendered,
    change: row.cashChange,
    paymentLabel: payments.length > 1
      ? text("จ่ายหลายวิธี", "Multiple payment methods")
      : posPaymentMethodLabel(payments[0].method, mode),
    vat: row.vat ? { ...row.vat, roundingAmount: rounding } : null,
    discountLines: row.discountLines.length > 0 ? row.discountLines : null,
    member: row.memberNo
      ? {
          name: row.memberName,
          memberNo: row.memberNo,
          pointsEarned: points?.pointsEarned ?? null,
          pointsBalance: points?.pointsBalance ?? null,
        }
      : null,
  };
}
