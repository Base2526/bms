import { buildXlsx, type ReportDoc } from "./documentGenerator";
import type { ArShiftSummary } from "./ar";
import type { PosShiftExportData } from "./pos";

function when(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function yesNo(value: boolean): string {
  return value ? "ใช่" : "ไม่ใช่";
}

/**
 * ไฟล์ตรวจสอบกะใช้ข้อมูลที่ service รวมจากฐานข้อมูลแล้วเท่านั้น จึงไม่ให้ route
 * หรือ browser คิดยอดคนละสูตรกับ X/Z report และไม่ใส่ PII ลูกค้าที่ไม่จำเป็น
 */
export function buildPosShiftWorkbook(
  data: PosShiftExportData,
  receivables: ArShiftSummary,
  generatedAt = new Date()
): Buffer {
  const r = data.report;
  const cashSales = r.byMethod.find((row) => row.method === "CASH")?.amount ?? 0;
  const doc: ReportDoc = {
    title: `รายละเอียดกะ ${r.deviceCode}`,
    subtitle: `${when(r.openedAt)}${r.closedAt ? ` – ${when(r.closedAt)}` : " – กำลังเปิด"}`,
    meta: [
      { label: "รหัสกะ", value: r.shiftId },
      { label: "เครื่อง", value: r.deviceCode },
      { label: "สาขา", value: r.locationName ?? "—" },
      { label: "สถานะ", value: r.status === "CLOSED" ? "ปิดแล้ว (Z Report)" : "กำลังเปิด (X Report)" },
      { label: "เปิดเมื่อ", value: when(r.openedAt) },
      { label: "เปิดโดย", value: r.openedByName ?? "—" },
      { label: "ปิดเมื่อ", value: when(r.closedAt) || "—" },
      { label: "ปิดโดย", value: r.closedByName ?? "—" },
      { label: "สร้างไฟล์เมื่อ", value: when(generatedAt.toISOString()) },
      { label: "ยอดขายสุทธิ", value: String(r.salesTotal) },
      { label: "จำนวนบิล", value: String(r.billCount) },
      { label: "เงินสดที่ควรมี", value: r.expectedCashHidden ? "ซ่อนจนกว่าจะปิดกะ" : String(r.expectedCash ?? "") },
      { label: "เงินสดที่นับได้", value: r.countedCash == null ? "—" : String(r.countedCash) },
      { label: "ส่วนต่าง", value: r.cashVariance == null ? "—" : String(r.cashVariance) },
    ],
    sheets: [
      {
        name: "ตรวจสอบยอด",
        columns: [
          { key: "item", label: "องค์ประกอบ" },
          { key: "operator", label: "เครื่องหมาย" },
          { key: "amount", label: "จำนวนเงิน" },
          { key: "note", label: "คำอธิบาย" },
        ],
        rows: [
          { item: "เงินตั้งต้น", operator: "+", amount: r.openingFloat, note: "รับจากผู้จัดการตอนเปิดกะ" },
          { item: "เงินสดจากการขาย", operator: "+", amount: cashSales, note: "บิลที่ไม่ถูกยกเลิก" },
          { item: "เงินเข้าอื่น", operator: "+", amount: r.cashIn, note: "รวมรับชำระหนี้เงินสดที่ลง movement แล้ว" },
          { item: "คืนเงินสด", operator: "−", amount: r.cashRefunds, note: "คืนในกะนี้ ไม่ใช่กะขายเดิม" },
          { item: "เงินออกอื่น", operator: "−", amount: r.cashOut, note: "ถอน/ย้าย/ค่าใช้จ่ายจากลิ้นชัก" },
          {
            item: "เงินสดที่ควรมี",
            operator: "=",
            amount: r.expectedCashHidden ? "ซ่อนจนกว่าจะปิดกะ" : r.expectedCash,
            note: r.expectedCashHidden ? "โหมดนับปิดตา" : "ค่าจาก server เดียวกับตอนปิดกะ",
          },
          { item: "เงินสดที่นับได้", operator: "", amount: r.countedCash, note: "มีหลังปิดกะ" },
          { item: "ส่วนต่าง", operator: "", amount: r.cashVariance, note: "นับได้ − ควรมี" },
          { item: "ขายเชื่อในกะ", operator: "", amount: receivables.creditSalesAmount, note: `${receivables.creditSalesCount} บิล; ไม่เข้าลิ้นชัก` },
          { item: "รับชำระหนี้", operator: "", amount: receivables.collectedAmount, note: `${receivables.collectedCount} รายการ` },
        ],
      },
      {
        name: "บิล",
        columns: [
          { key: "receiptNo", label: "เลขใบเสร็จ" }, { key: "orderId", label: "Order ID" },
          { key: "soldAt", label: "เวลา" }, { key: "cashier", label: "แคชเชียร์" },
          { key: "status", label: "สถานะ" }, { key: "itemCount", label: "จำนวนรายการ" },
          { key: "grossTotal", label: "ก่อนส่วนลด" }, { key: "discountTotal", label: "ส่วนลด" },
          { key: "roundingAmount", label: "ปัดเศษ" }, { key: "netTotal", label: "ยอดสุทธิ" },
          { key: "voided", label: "ยกเลิกบิล" }, { key: "voidedAt", label: "เวลายกเลิก" },
        ],
        rows: data.bills.map((row) => ({
          ...row, soldAt: when(row.soldAt), voided: yesNo(Boolean(row.voidedAt)),
          voidedAt: when(row.voidedAt),
        })),
      },
      {
        name: "การชำระเงิน",
        columns: [
          { key: "receiptNo", label: "เลขใบเสร็จ" }, { key: "orderId", label: "Order ID" },
          { key: "paymentId", label: "Payment ID" }, { key: "paidAt", label: "เวลา" },
          { key: "method", label: "วิธีชำระ" }, { key: "status", label: "สถานะ" },
          { key: "amount", label: "ยอดชำระ" }, { key: "cashTendered", label: "รับเงินสดมา" },
          { key: "cashChange", label: "เงินทอน" }, { key: "reference", label: "เลขอ้างอิง" },
        ],
        rows: data.payments.map((row) => ({ ...row, paidAt: when(row.paidAt) })),
      },
      {
        name: "เงินเข้าออกลิ้นชัก",
        columns: [
          { key: "createdAt", label: "เวลา" }, { key: "direction", label: "เข้า/ออก" },
          { key: "amount", label: "จำนวนเงิน" }, { key: "reason", label: "เหตุผล" },
          { key: "actor", label: "ผู้ทำรายการ" }, { key: "approvedBy", label: "ผู้อนุมัติ" },
          { key: "movementId", label: "Movement ID" },
        ],
        rows: data.cashMovements.map((row) => ({ ...row, createdAt: when(row.createdAt) })),
      },
      {
        name: "คืนสินค้าและคืนเงิน",
        columns: [
          { key: "returnedAt", label: "เวลารับคืน" }, { key: "kind", label: "ประเภท" },
          { key: "receiptNo", label: "เลขใบเสร็จเดิม" }, { key: "orderId", label: "Order ID" },
          { key: "returnId", label: "Return ID" }, { key: "returnMode", label: "รูปแบบคืน" },
          { key: "returnAmount", label: "ยอดรับคืน" }, { key: "note", label: "เหตุผล" },
          { key: "returnedBy", label: "ผู้รับคืน" }, { key: "approvedBy", label: "ผู้อนุมัติ" },
          { key: "settlementStatus", label: "สถานะรวม" }, { key: "method", label: "วิธีคืนเงิน" },
          { key: "allocationAmount", label: "ยอดคืนช่องทางนี้" },
          { key: "allocationStatus", label: "สถานะคืนเงินจริง" },
          { key: "externalRef", label: "เลขอ้างอิงคืนเงิน" },
          { key: "completedAt", label: "เวลายืนยัน" }, { key: "completedBy", label: "ผู้ยืนยัน" },
        ],
        rows: data.refunds.map((row) => ({
          ...row, returnedAt: when(row.returnedAt), completedAt: when(row.completedAt),
        })),
      },
      {
        name: "ค่าใช้จ่าย",
        columns: [
          { key: "createdAt", label: "เวลาเบิก/จ่าย" }, { key: "settledAt", label: "เวลาปิดยอด" },
          { key: "kind", label: "ประเภท" }, { key: "fundingSource", label: "แหล่งเงิน" },
          { key: "category", label: "หมวด" }, { key: "description", label: "รายละเอียด" },
          { key: "payee", label: "ผู้รับเงิน" }, { key: "status", label: "สถานะ" },
          { key: "advancedAmount", label: "ยอดเบิก" }, { key: "actualAmount", label: "ยอดจริง" },
          { key: "returnedAmount", label: "เงินทอนคืน" }, { key: "extraCashOut", label: "จ่ายเพิ่ม" },
          { key: "receiptRef", label: "เลขหลักฐาน" }, { key: "actor", label: "ผู้ทำรายการ" },
          { key: "approvedBy", label: "ผู้อนุมัติ" }, { key: "expenseId", label: "Expense ID" },
        ],
        rows: data.expenses.map((row) => ({
          ...row, createdAt: when(row.createdAt), settledAt: when(row.settledAt),
        })),
      },
      {
        name: "เปิดลิ้นชักไม่ขาย",
        columns: [
          { key: "createdAt", label: "เวลา" }, { key: "reason", label: "เหตุผล" },
          { key: "actor", label: "ผู้เปิด" }, { key: "eventId", label: "Event ID" },
        ],
        rows: data.noSales.map((row) => ({ ...row, createdAt: when(row.createdAt) })),
      },
      {
        name: "ขายเชื่อและรับชำระ",
        columns: [
          { key: "createdAt", label: "เวลา" }, { key: "activityType", label: "ประเภท" },
          { key: "orderId", label: "Order ID" }, { key: "method", label: "วิธีรับเงิน" },
          { key: "amount", label: "จำนวนเงิน" }, { key: "reference", label: "เลขอ้างอิง" },
          { key: "actor", label: "ผู้รับชำระ" }, { key: "activityId", label: "Activity ID" },
        ],
        rows: data.creditActivity.map((row) => ({ ...row, createdAt: when(row.createdAt) })),
      },
    ],
  };
  return buildXlsx(doc);
}
