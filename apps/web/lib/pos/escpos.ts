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
  storeName: string;
  branchCode: string | null;
  taxId: string | null;
  posNo: string | null;
  vatIncluded: boolean;
  docTitle: string;
  docNo: string | null;
  at: string;
  cashier: string | null;
  lines: ReceiptLine[];
  itemCount: number;
  total: number;
  tendered?: number | null;
  change?: number | null;
  paymentLabel?: string | null;
};

function money(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ประกอบใบกำกับภาษีอย่างย่อ — โครงตามใบจริงของ 7-Eleven ที่ใช้อ้างอิงตอนออกแบบ
 * (ชื่อร้าน+สาขา / เลขผู้เสียภาษี+VAT Included / POS# / รายการ / ยอด / เงินทอน)
 */
export function buildReceipt(payload: ReceiptPayload, opts: EscPosOptions = {}): Uint8Array {
  const b = new EscPosBuilder(opts);

  b.align(1).bold(true).line(payload.storeName).bold(false);
  if (payload.branchCode) b.line(`(สาขา ${payload.branchCode})`);
  if (payload.taxId) b.line(`TAX#${payload.taxId}${payload.vatIncluded ? " (VAT Included)" : ""}`);
  if (payload.posNo) b.line(`POS#${payload.posNo}`);
  b.line(payload.docTitle);

  b.align(0).divider();
  for (const l of payload.lines) {
    b.columnsLine(`${l.qty} ${l.name}`, money(l.amount) + (l.vatExempt ? "N" : ""));
  }
  b.divider();

  b.bold(true).columnsLine(`ยอดสุทธิ ${payload.itemCount} ชิ้น`, money(payload.total)).bold(false);
  if (payload.paymentLabel) b.columnsLine("ชำระโดย", payload.paymentLabel);
  if (payload.tendered != null) {
    b.columnsLine("รับเงิน/เงินทอน", `${money(payload.tendered)} / ${money(payload.change ?? 0)}`);
  }

  b.feed(1);
  // ใช้ตัวคั่น ASCII เท่านั้น — TIS-620 ไม่มี "·" จะพิมพ์ออกมาเป็น ?
  if (payload.docNo) b.line(`${payload.docNo}  ${payload.at}`);
  else b.line(payload.at);
  if (payload.cashier) b.line(`แคชเชียร์ ${payload.cashier}`);

  b.cut();
  return b.build();
}

/** เปิดลิ้นชักอย่างเดียว — ใช้ตอนทอนเงินโดยไม่ได้ขาย หรือทดสอบสายลิ้นชัก */
export function buildDrawerKick(opts: EscPosOptions = {}): Uint8Array {
  return new EscPosBuilder(opts).openDrawer().build();
}
