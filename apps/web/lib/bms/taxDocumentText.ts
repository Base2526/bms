// =============================================================
// ข้อความบนเอกสารภาษี — ใช้ร่วมกันทั้งหน้าพิมพ์หลังบ้าน สำเนาของลูกค้า และ PDF
// -------------------------------------------------------------
// pure (ไม่ import อะไรที่แตะฐานข้อมูล) เพื่อให้หน้า client ใช้ได้ และสามที่พิมพ์ออกมาตรงกัน
// =============================================================

export { formatTaxDate } from "./taxReportMath";

export function taxBranchLabel(code: string): string {
  return code === "00000" ? "สำนักงานใหญ่" : `สาขา ${code}`;
}

/**
 * บรรทัดเลขผู้เสียภาษีของคู่สัญญา
 *
 * สาขาพิมพ์เฉพาะผู้ประกอบการ (มีรหัสสาขา) — บุคคลธรรมดาไม่มี "สำนักงานใหญ่"
 * ไม่มีเลขผู้เสียภาษี = ไม่พิมพ์บรรทัดนี้เลย (ผู้ซื้อที่ไม่ได้จด VAT ไม่ต้องมี
 * ตามประกาศอธิบดีฯ ฉบับที่ 199) ดีกว่าพิมพ์ "เลขผู้เสียภาษี " ว่าง ๆ
 */
export function taxIdentityLine(taxId: string | null | undefined, branchCode: string | null | undefined): string | null {
  const id = taxId?.trim();
  if (!id) return null;
  const branch = branchCode?.trim();
  return branch ? `เลขประจำตัวผู้เสียภาษี ${id} · ${taxBranchLabel(branch)}` : `เลขประจำตัวผู้เสียภาษี ${id}`;
}

/** ป้ายกำกับฉบับที่พิมพ์ — ร้านเลือกเองตอนพิมพ์ (ระบบไม่นับจำนวนครั้งที่พิมพ์) */
export type TaxPrintCopy = "ORIGINAL" | "COPY";
export function taxPrintCopyLabel(copy: TaxPrintCopy): string {
  return copy === "ORIGINAL" ? "ต้นฉบับ" : "สำเนา";
}
