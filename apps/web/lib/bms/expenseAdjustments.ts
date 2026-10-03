import { isIsoCalendarDate } from "./taxReportMath";

export const isExpenseAdjustment = (kind: string) =>
  kind === "SUPPLIER_CREDIT_NOTE" || kind === "SUPPLIER_DEBIT_NOTE";

export const expenseDocumentSign = (kind: string): 1 | -1 => kind === "SUPPLIER_CREDIT_NOTE" ? -1 : 1;

/** Supplier notes belong to the month received, not the invoice's deferred-claim window. */
export function normalizeExpenseAdjustment(input: {
  documentKind: string; documentDate: string; receivedDate?: string | null;
  referenceDocumentNo?: string | null; adjustmentReason?: string | null;
  vatClaimMonth?: string | null; vatAmount?: number | null;
  whtAmount?: number | null; whtRate?: number | null; whtIncomeType?: string | null;
}, now = new Date()) {
  if (!isExpenseAdjustment(input.documentKind)) {
    if (input.receivedDate || input.referenceDocumentNo || input.adjustmentReason) throw new Error("ข้อมูลปรับปรุงภาษีใช้ได้เฉพาะใบลดหนี้/ใบเพิ่มหนี้");
    return null;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (!input.receivedDate || !isIsoCalendarDate(input.receivedDate) || input.receivedDate < input.documentDate || input.receivedDate > today) {
    throw new Error("วันที่ได้รับใบลดหนี้/ใบเพิ่มหนี้ต้องเป็นวันที่จริง ไม่ก่อนวันที่เอกสาร และไม่เป็นอนาคต");
  }
  const referenceDocumentNo = input.referenceDocumentNo?.trim();
  const adjustmentReason = input.adjustmentReason?.trim();
  if (!referenceDocumentNo || referenceDocumentNo.length > 500 || !adjustmentReason || adjustmentReason.length > 2000) throw new Error("ต้องระบุเลขใบกำกับภาษีอ้างอิง (ไม่เกิน 500 ตัวอักษร) และเหตุผล (ไม่เกิน 2000 ตัวอักษร)");
  if (!Number.isFinite(input.vatAmount) || Number(input.vatAmount) <= 0) throw new Error("ใบปรับปรุงภาษีซื้อต้องระบุยอด VAT ที่ปรับปรุงเป็นจำนวนบวก");
  if (input.whtAmount || input.whtRate || input.whtIncomeType) throw new Error("ใบปรับปรุงภาษีซื้อไม่ใช้บันทึกหัก ณ ที่จ่าย");
  const vatClaimMonth = `${input.receivedDate.slice(0, 7)}-01`;
  if (input.vatClaimMonth && input.vatClaimMonth !== vatClaimMonth) throw new Error("ใบลดหนี้/ใบเพิ่มหนี้ต้องใช้เดือนที่ได้รับเอกสาร");
  return { receivedDate: input.receivedDate, referenceDocumentNo, adjustmentReason, vatClaimMonth };
}
