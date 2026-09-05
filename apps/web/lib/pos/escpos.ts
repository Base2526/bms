// =============================================================
// ESC/POS — สร้างคำสั่งสำหรับเครื่องพิมพ์ใบเสร็จความร้อน + เปิดลิ้นชัก
// -------------------------------------------------------------
// ทำไมต้องมี ทั้งที่ print dialog ของเบราว์เซอร์ก็พิมพ์ได้:
//   • print dialog เปิด popup ทุกครั้ง — 200 บิลต่อวันคือ 200 ครั้งที่ต้องกด
//   • ตัดกระดาษอัตโนมัติไม่ได้
//   • เปิดลิ้นชักไม่ได้เลย ซึ่งเป็นเหตุผลหลักที่ต้องใช้ ESC/POS
//
// ⚠️ ยังไม่เคยทดสอบกับเครื่องพิมพ์จริง — ไฟล์นี้สร้าง byte ตามสเปก ESC/POS
// มาตรฐาน แต่รุ่นที่ขายในไทยมีรายละเอียดต่างกัน โดยเฉพาะ "หน้ารหัสภาษาไทย"
// ซึ่งบางรุ่นเป็น 255 บางรุ่นเป็น 20/21 → ตั้งค่าได้ที่ codePage
// ต้องลองกับเครื่องจริงก่อนใช้งานจริงเสมอ
//
// ภาษาไทยบนเครื่องพิมพ์ความร้อนใช้ TIS-620 ไม่ใช่ UTF-8 — ส่ง UTF-8 ไปจะได้
// ตัวอักษรขยะ เพราะ 1 อักษรไทยใน UTF-8 กิน 3 ไบต์ แต่เครื่องอ่านทีละไบต์
// =============================================================

import { sanitizeCode39 } from "./barcode";
import { receiptLabel, receiptLocale, type ReceiptLanguageMode } from "./receiptI18n";

const ESC = 0x1b;
const GS = 0x1d;

export type EscPosOptions = {
  /** หน้ารหัสภาษาไทยของเครื่อง — ลองกับเครื่องจริงแล้วปรับ (พบบ่อย: 255, 20, 21) */
  codePage?: number;
  /** จำนวนตัวอักษรต่อบรรทัด — 58mm ≈ 32, 80mm ≈ 42–48 */
  columns?: number;
};

/**
 * แปลงข้อความเป็นไบต์ TIS-620
 * อักษรไทย U+0E01–U+0E5B → 0xA1–0xFB (บวก 0xA0)
 * อักษรที่แปลงไม่ได้ → "?" ดีกว่าปล่อยไบต์มั่วให้เครื่องพิมพ์ตีความเอง
 */
export function toTis620(text: string): number[] {
  // เตือนตัวเอง: อักษรที่ไม่ใช่ ASCII และไม่ใช่ไทย (·, –, ", …) จะกลายเป็น ?
  // ข้อความที่ประกอบในไฟล์นี้จึงต้องใช้ ASCII กับอักษรไทยล้วน
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp < 0x80) out.push(cp);
    else if (cp >= 0x0e01 && cp <= 0x0e5b) out.push(cp - 0x0e00 + 0xa0);
    else out.push(0x3f); // ?
  }
  return out;
}

/** ตัวช่วยประกอบคำสั่งทีละบรรทัด แล้วค่อยรวมเป็นไบต์ตอนท้าย */
export class EscPosBuilder {
  private bytes: number[] = [];
  private readonly columns: number;

  constructor(private readonly opts: EscPosOptions = {}) {
    this.columns = opts.columns ?? 42;
    // ESC @ — รีเซ็ตเครื่องก่อนเสมอ ไม่งั้นค้างสไตล์จากบิลก่อน (ตัวหนา/ขนาด)
    this.bytes.push(ESC, 0x40);
    // ESC t n — เลือกหน้ารหัสภาษาไทย
    this.bytes.push(ESC, 0x74, opts.codePage ?? 255);
  }

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }

  /** 0 ซ้าย · 1 กลาง · 2 ขวา */
  align(mode: 0 | 1 | 2): this {
    return this.raw(ESC, 0x61, mode);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** ขยายตัวอักษร 1–2 เท่า (ใช้กับยอดเงินให้อ่านง่าย) */
  size(width: 1 | 2 = 1, height: 1 | 2 = 1): this {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  text(s: string): this {
    this.bytes.push(...toTis620(s));
    return this;
  }

  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }

  /** ชื่อสินค้าชิดซ้าย ราคาชิดขวา บนบรรทัดเดียว — ตัดชื่อถ้ายาวเกิน */
  columnsLine(left: string, right: string): this {
    const room = Math.max(1, this.columns - right.length - 1);
    const clipped = left.length > room ? left.slice(0, room) : left;
    const gap = Math.max(1, this.columns - clipped.length - right.length);
    return this.line(clipped + " ".repeat(gap) + right);
  }

  divider(ch = "-"): this {
    return this.line(ch.repeat(this.columns));
  }

  feed(n = 1): this {
    return this.raw(ESC, 0x64, n);
  }

  /** GS V B n — ตัดกระดาษแบบเว้นติ่ง พร้อมเลื่อนกระดาษพ้นหัวตัดก่อน */
  cut(feedBefore = 4): this {
    return this.raw(GS, 0x56, 0x42, feedBefore);
  }

  /**
   * ESC p m t1 t2 — เปิดลิ้นชัก
   * ลิ้นชักต่อกับพอร์ต RJ11 ท้ายเครื่องพิมพ์ ไม่ได้ต่อคอมโดยตรง
   * pin 2 (m=0) คือขาที่ใช้กันเกือบทุกรุ่น ถ้าไม่เปิดให้ลองขา 5 (m=1)
   */
  openDrawer(pin: 0 | 1 = 0): this {
    return this.raw(ESC, 0x70, pin, 0x19, 0xfa);
  }

  /**
   * GS k 69 — บาร์โค้ด CODE39 พร้อมเลขกำกับใต้แท่ง (GS H 2)
   * ใช้ m=69 แบบระบุความยาว ไม่ใช่ m=4 ที่จบด้วย NUL — รุ่นที่ไม่รองรับ NUL
   * จะพิมพ์ขยะยาวจนกระดาษหมด
   * ข้ามให้เงียบเมื่อไม่มีอักขระที่เข้ารหัสได้ — บิลต้องพิมพ์ออกได้เสมอ
   */
  barcode39(data: string, height = 60, moduleWidth: 2 | 3 = 2): this {
    const text = sanitizeCode39(data);
    if (!text) return this;
    return this.raw(GS, 0x68, height)
      .raw(GS, 0x77, moduleWidth)
      .raw(GS, 0x48, 2)
      .raw(GS, 0x6b, 69, text.length, ...text.split("").map((ch) => ch.charCodeAt(0)));
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export type ReceiptLine = {
  name: string;
  qty: number;
  amount: number;
  /** ธง N บนใบกำกับอย่างย่อ = สินค้ายกเว้น VAT */
  vatExempt?: boolean;
};

export type ReceiptPayload = {
  languageMode?: ReceiptLanguageMode;
  storeName: string;
  locationId?: string | null;
  branchCode: string | null;
  taxId: string | null;
  posDeviceId?: string | null;
  posNo: string | null;
  shiftId?: string | null;
  vatIncluded: boolean;
  docTitle: string;
  docNo: string | null;
  /** Internal order id. Printed short as a technical reference, not as the human search number. */
  orderId?: string | null;
  /** เอกสารภาษีที่ออกคู่กับสลิปนี้ เช่น ใบลดหนี้; ไม่ใช้เป็นเลขของสลิปเอง */
  relatedDocNo?: string | null;
  /** เลขบิลขายต้นทางของใบรับคืน/ใบเตรียมเปลี่ยน */
  referenceDocNo?: string | null;
  /** ค่าที่เข้ารหัสเป็น barcode; แยกจาก docNo เพื่อให้สลิปคืนสแกนกลับไปหาบิลเดิม */
  barcodeValue?: string | null;
  /** เลขที่บิลที่คนอ่าน (ต่างจาก docNo ซึ่งเป็นเลขใบกำกับ) */
  billNo?: string | null;
  at: string;
  cashier: string | null;
  /** บรรทัดอธิบายใต้หัวใบ เช่น "ราคาสินค้าเป็นราคาป้าย ณ ตอนขาย ส่วนลดแสดงแยกด้านล่าง" */
  notes?: string[] | null;
  lines: ReceiptLine[];
  itemCount: number;
  total: number;
  tendered?: number | null;
  change?: number | null;
  paymentLabel?: string | null;
  /**
   * รายวิธีชำระของบิลนี้ — บิลแบ่งจ่ายต้องบอกว่าแต่ละช่องทางรับไปเท่าไร
   * ไม่ส่งมา = ตกไปใช้ `paymentLabel` + `tendered/change` แบบเดิม
   */
  payments?: Array<{
    label: string;
    amount: number;
    ref?: string | null;
    tendered?: number | null;
    change?: number | null;
  }> | null;
  /** ใบรับคืน: เงินกลับไปทางไหน และยังรอยืนยันอยู่ไหม — เอกสารที่ไม่บอกเรื่องนี้ไม่ครบ */
  refundLines?: Array<{
    label: string;
    amount: number;
    ref?: string | null;
    pending?: boolean;
  }> | null;
  /** เหตุผลการคืน/ยกเลิกที่พนักงานบันทึกไว้ */
  returnReason?: string | null;
  /**
   * ปัดเศษเงินสดที่รวมอยู่ใน total แล้ว
   * แยกจาก `vat.roundingAmount` เพราะ **ร้านที่ยังไม่จด VAT ก็ปัดเศษได้** และไม่มีบล็อก VAT
   * ให้ซ่อนบรรทัดนี้ไว้ข้างใน — เดิมกระดาษของร้านแบบนั้นจึงไม่มีบรรทัดปัดเศษเลย
   */
  roundingAmount?: number | null;
  /** ตัวเลขจากใบกำกับที่ออกจริง — ไม่ส่งมา = ไม่พิมพ์บรรทัดแยกฐาน/VAT */
  vat?: {
    rate: number;
    vatAmount: number;
    netBeforeVat: number;
    exemptAmount?: number;
    roundingAmount?: number;
  } | null;
  /** ส่วนลดแยกที่มา (7.96) — พิมพ์ก่อนยอดสุทธิ ลูกค้าตรวจได้ว่าลดจากอะไร */
  discountLines?: Array<{ label: string; amount: number }> | null;
  /** สมาชิก + แต้ม (7.96) — ไม่ส่งมา = บิลนี้ไม่ผูกสมาชิก ไม่พิมพ์ท้ายบิล */
  member?: {
    name: string | null;
    memberNo: string | null;
    pointsEarned: number | null;
    pointsBalance: number | null;
  } | null;
};

function money(n: number, mode: ReceiptLanguageMode): string {
  return n.toLocaleString(receiptLocale(mode), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ประกอบใบกำกับภาษีอย่างย่อ — โครงตามใบจริงของ 7-Eleven ที่ใช้อ้างอิงตอนออกแบบ
 * (ชื่อร้าน+สาขา / เลขผู้เสียภาษี+VAT Included / POS# / รายการ / ยอด / เงินทอน)
 */
export function buildReceipt(payload: ReceiptPayload, opts: EscPosOptions = {}): Uint8Array {
  const b = new EscPosBuilder(opts);
  const mode = payload.languageMode ?? "th";
  const label = (thai: string, english: string) => receiptLabel(mode, thai, english);

  b.align(1).bold(true).line(payload.storeName).bold(false);
  if (payload.branchCode) b.line(`(${label("สาขา", "Branch")} ${payload.branchCode})`);
  if (payload.taxId) b.line(`TAX#${payload.taxId}${payload.vatIncluded ? ` (${label("รวม VAT", "VAT Included")})` : ""}`);
  if (payload.posNo) b.line(`POS#${payload.posNo}`);
  if (payload.locationId) b.line(`Location ${payload.locationId.slice(0, 8)}`);
  if (payload.posDeviceId) b.line(`Device ${payload.posDeviceId.slice(0, 8)}`);
  if (payload.shiftId) b.line(`Shift ${payload.shiftId.slice(0, 8)}`);
  b.line(payload.docTitle);
  if (payload.referenceDocNo) b.line(`${label("อ้างอิงบิลเดิม", "Original bill")} ${payload.referenceDocNo}`);
  if (payload.relatedDocNo) b.line(`${label("ใบลดหนี้", "Credit note")} ${payload.relatedDocNo}`);

  b.align(0);
  if (payload.billNo) b.columnsLine(label("เลขที่บิล", "Bill No"), payload.billNo);
  for (const note of payload.notes ?? []) b.line(note);
  b.divider();
  for (const l of payload.lines) {
    b.columnsLine(`${l.qty} ${l.name}`, money(l.amount, mode) + (l.vatExempt ? "N" : ""));
  }
  b.divider();

  // ส่วนลดแยกบรรทัดก่อนยอด VAT — ยอดพวกนี้รวมอยู่ใน total แล้ว
  for (const d of payload.discountLines ?? []) {
    if (d.amount > 0) b.columnsLine(d.label, `-${money(d.amount, mode)}`);
  }

  // ใบกำกับภาษีอย่างย่อต้องแสดงยอด VAT แยก — พิมพ์ก่อนยอดสุทธิเหมือนใบจริง
  if (payload.vat) {
    b.columnsLine(label("มูลค่าก่อน VAT", "Net before VAT"), money(payload.vat.netBeforeVat, mode));
    b.columnsLine(`VAT ${payload.vat.rate}%`, money(payload.vat.vatAmount, mode));
    if (payload.vat.exemptAmount) b.columnsLine(label("ยกเว้น VAT (N)", "VAT exempt (N)"), money(payload.vat.exemptAmount, mode));
  }
  // ปัดเศษพิมพ์บรรทัดเดียวเสมอ และอยู่นอกบล็อก VAT — ร้านที่ยังไม่จด VAT ก็ปัดเศษได้
  const rounding = payload.roundingAmount ?? payload.vat?.roundingAmount ?? 0;
  if (rounding) b.columnsLine(label("ปัดเศษเงินสด", "Cash rounding"), money(rounding, mode));
  b.bold(true).columnsLine(`${label("ยอดสุทธิ", "Total")} ${payload.itemCount} ${label("ชิ้น", "items")}`, money(payload.total, mode)).bold(false);
  if (payload.returnReason) b.line(`${label("เหตุผล", "Reason")}: ${payload.returnReason}`);

  // เงินกลับไปทางไหน (ใบรับคืน) — ต้องอยู่บนกระดาษ ไม่ใช่เห็นแค่บนจอ
  for (const refund of payload.refundLines ?? []) {
    b.columnsLine(
      `${label("คืนโดย", "Refund via")} ${refund.label}${refund.pending ? ` (${label("รอยืนยัน", "pending")})` : ""}`,
      money(refund.amount, mode)
    );
    if (refund.ref) b.columnsLine(label("เลขอ้างอิงคืนเงิน", "Refund reference"), refund.ref);
  }

  if (payload.payments?.length) {
    // บิลแบ่งจ่ายต้องบอกทีละช่องทาง — เดิมพิมพ์ได้แค่ "จ่ายหลายวิธี" บรรทัดเดียว
    for (const payment of payload.payments) {
      b.columnsLine(`${label("ชำระโดย", "Paid by")} ${payment.label}`, money(payment.amount, mode));
      if (payment.tendered != null) {
        b.columnsLine(label("รับเงิน/เงินทอน", "Tendered/Change"), `${money(payment.tendered, mode)} / ${money(payment.change ?? 0, mode)}`);
      }
      if (payment.ref) b.columnsLine(label("เลขอ้างอิง", "Reference"), payment.ref);
    }
  } else {
    if (payload.paymentLabel) b.columnsLine(label("ชำระโดย", "Paid by"), payload.paymentLabel);
    if (payload.tendered != null) {
      b.columnsLine(label("รับเงิน/เงินทอน", "Tendered/Change"), `${money(payload.tendered, mode)} / ${money(payload.change ?? 0, mode)}`);
    }
  }

  b.feed(1);
  // ใช้ตัวคั่น ASCII เท่านั้น — TIS-620 ไม่มี "·" จะพิมพ์ออกมาเป็น ?
  if (payload.docNo) b.line(`${payload.docNo}  ${payload.at}`);
  else b.line(payload.at);
  if (payload.orderId) b.line(`Order ${payload.orderId.slice(0, 8)}`);
  if (payload.cashier) b.line(`${label("แคชเชียร์", "Cashier")} ${payload.cashier}`);

  // แต้มท้ายบิล — ลูกค้าใช้ตรวจว่าได้แต้มครบ ไม่ต้องถามพนักงาน
  if (payload.member) {
    b.feed(1);
    const who = [payload.member.memberNo, payload.member.name].filter(Boolean).join(" ");
    if (who) b.line(`${label("สมาชิก", "Member")} ${who}`);
    if (payload.member.pointsEarned != null) {
      b.columnsLine(label("แต้มที่ได้บิลนี้", "Points earned"), `+${payload.member.pointsEarned}`);
    }
    if (payload.member.pointsBalance != null) {
      b.columnsLine(label("แต้มคงเหลือ", "Points balance"), String(payload.member.pointsBalance));
    }
  }

  // บาร์โค้ดเลขบิลไว้สแกนตอนรับคืนของ — สลิปคืนต้องใช้บิลขายต้นทาง ไม่ใช่เลข CN
  const barcodeValue = payload.barcodeValue ?? payload.docNo;
  if (barcodeValue) b.feed(1).align(1).barcode39(barcodeValue).align(0);

  b.cut();
  return b.build();
}

/** เปิดลิ้นชักอย่างเดียว — ใช้ตอนทอนเงินโดยไม่ได้ขาย หรือทดสอบสายลิ้นชัก */
export function buildDrawerKick(opts: EscPosOptions = {}): Uint8Array {
  return new EscPosBuilder(opts).openDrawer().build();
}
