// =============================================================
// เลขเอกสารภาษี + วันที่ของเอกสาร — pure (ไม่ import อะไรเลย เทสได้โดยไม่มี DB)
// -------------------------------------------------------------
// ⚠️ วันที่ของเอกสารภาษีคือวันที่ในประเทศไทย ไม่ใช่วันที่ของเครื่องที่รันโค้ด
//
// container ของเว็บและ Postgres รันเป็น UTC ทั้งคู่ เดิมเลขเอกสารคิดจาก
// `new Date().getDate()` และ `issue_date` ใช้ `DEFAULT CURRENT_DATE` → บิลที่ขาย
// ช่วง 00:00–06:59 น. ได้วันที่ของ "เมื่อวาน" ทั้งในเลขเอกสารและในคอลัมน์ที่
// รายงานภาษีขายใช้แบ่งเดือน · บิลตอน 00:30 น. วันที่ 1 จึงไปอยู่ใน ภ.พ.30 ของเดือนก่อน
//
// จงใจล็อกไว้ที่ Asia/Bangkok ไม่ใช้ `bms_store_profile.timezone` — เอกสารชุดนี้
// เป็นเอกสารของกรมสรรพากรไทย และรายงานทุกตัวใน reports.ts ตัดวันด้วย Asia/Bangkok
// อยู่แล้ว ถ้าสองฝั่งใช้เขตเวลาต่างกัน รายงานจะนับบิลคนละวันกับเลขบนกระดาษ
// (ค่า timezone ที่พิมพ์ผิดในโปรไฟล์ร้านก็ไม่มีทางทำให้การขายล้มด้วย)
// =============================================================

export const TAX_TIME_ZONE = "Asia/Bangkok";

export type TaxClock = {
  /** YYYY-MM-DD ตามเวลาไทย — ค่าที่เขียนลง bms_tax_documents.issue_date */
  isoDate: string;
  /** ปี ค.ศ. เต็ม — ใช้เป็น period_key ของตัวนับรายปี */
  year: number;
  month: number;
  day: number;
};

const FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** แปลงเวลาจริงหนึ่งจุด (instant) เป็นวันที่ของเอกสารภาษี */
export function taxClockOf(instant: Date): TaxClock {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("เวลาออกเอกสารไม่ถูกต้อง");
  }
  const parts = FORMATTER.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return {
    isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
  };
}

/**
 * ประกอบเลขเอกสาร: prefix + ปี(2หลัก) + เดือน + วัน + ลำดับ 4 หลัก
 * เลียนแบบใบวราภรณ์ (2512010004 = 25/12/01 ลำดับ 0004) เป็นค่าเริ่มต้น
 * ร้านที่มีรูปแบบของตัวเองตั้ง receipt_prefix ทับได้ และคอลัมน์เก็บเป็น TEXT
 * เพราะของจริงมีทั้ง KFC2522205 และ 006/8731
 */
export function buildTaxDocNo(
  prefix: string | null,
  clock: TaxClock,
  seq: number,
  era: "BE" | "CE"
): string {
  const year = (era === "BE" ? clock.year + 543 : clock.year) % 100;
  const stamp = `${String(year).padStart(2, "0")}${String(clock.month).padStart(2, "0")}${String(clock.day).padStart(2, "0")}`;
  return `${prefix ?? ""}${stamp}${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------
// prefix ที่ทำให้เลขไม่ชนกัน
// ---------------------------------------------------------------
//
// `bms_tax_documents` บังคับ UNIQUE (tenant_id, doc_type, doc_no) = ห้ามซ้ำ "ทั้งร้าน"
// แต่ตัวนับรันแยก — ใบย่อต่อ "เครื่อง" ใบเต็ม/ใบลดหนี้ต่อ "สาขา" · เลขที่ออกมาจึงต้อง
// มีส่วนที่บอกว่ามาจากเครื่อง/สาขาไหน ไม่งั้นสองตัวนับที่เริ่มพร้อมกันได้เลขเดียวกันในวัน
// เดียวกัน แล้ว INSERT ตัวที่สองชน unique
//
//  - ใบเต็ม/ใบลดหนี้ของสาขาที่สองขึ้นไป ชนกับสำนักงานใหญ่ทันทีที่ออกใบแรกของปีวันเดียวกัน
//  - ใบย่อออกในทรานแซกชันเดียวกับการขาย → ชนแล้ว **การขายทั้งบิล rollback หน้าลูกค้า**
//
// กติกาจงใจไม่เปลี่ยนรูปแบบเลขของร้านที่ไม่มีทางชนอยู่แล้ว (สำนักงานใหญ่ · เครื่องที่ prefix
// ไม่ซ้ำใคร) — เลขกลางปีที่เปลี่ยนรูปแบบเองโดยไม่มีเหตุผลคือสิ่งที่นักบัญชีต้องตามอธิบาย

export type TaxDocLocation = { isHeadOffice: boolean; branchCode: string | null };

function branchTag(location: TaxDocLocation): string {
  if (location.isHeadOffice) return "";
  const code = (location.branchCode ?? "").trim();
  return code ? `${code}-` : "";
}

/** ใบกำกับเต็มรูป — สำนักงานใหญ่คงรูปเดิม สาขาได้รหัสสาขานำหน้า */
export function fullInvoicePrefix(location: TaxDocLocation): string | null {
  return branchTag(location) || null;
}

/** ใบลดหนี้ — "CN" เสมอ ต่อด้วยรหัสสาขาถ้าไม่ใช่สำนักงานใหญ่ */
export function creditNotePrefix(location: TaxDocLocation): string {
  return `CN${branchTag(location)}`;
}

/** prefix ที่ร้านตั้งให้เครื่อง หลังตัดช่องว่าง (ว่าง = ไม่ได้ตั้ง) */
export function normalizeReceiptPrefix(prefix: string | null | undefined): string {
  return (prefix ?? "").trim();
}

/**
 * ใบกำกับอย่างย่อ — ใช้ prefix ที่ร้านตั้งไว้ตรง ๆ เมื่อไม่ซ้ำกับเครื่องอื่นของร้าน
 * ถ้าซ้ำ (รวมถึงหลายเครื่องที่ไม่ได้ตั้งเลย) ต่อรหัสเครื่องเข้าไปเพื่อให้เลขไม่ชน
 *
 * `sharedWithAnotherDevice` ต้องนับเครื่องที่ปิดใช้งานแล้วด้วย — เลขที่เครื่องนั้นเคย
 * ออกยังอยู่ในตาราง และยังชนได้เหมือนเดิม
 */
export function abbreviatedInvoicePrefix(device: {
  receiptPrefix: string | null;
  code: string;
  sharedWithAnotherDevice: boolean;
}): string | null {
  if (!device.sharedWithAnotherDevice) return device.receiptPrefix ?? null;
  return `${normalizeReceiptPrefix(device.receiptPrefix)}${device.code.trim()}-`;
}
