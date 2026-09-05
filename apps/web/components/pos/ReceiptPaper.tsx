"use client";
// =============================================================
// ใบเสร็จบนจอ — renderer ตัวที่สองของ `ReceiptPayload` ตัวเดียวกับที่พิมพ์จริง
// -------------------------------------------------------------
// ทำไมต้องมี:
//
//   1. **เป็น preview** — เดิมกล่อง "ปิดบิลสำเร็จ" โชว์ยอด/ส่วนลด/VAT แต่ไม่มีรายการสินค้า
//      ส่วนกล่อง "รายละเอียดบิล" โชว์รายการแต่ไม่มีส่วนลด/VAT · **ผลคือบิลที่ติดราคาส่ง
//      หรือโปรโมชัน จะแสดงรายการที่บวกแล้วไม่เท่ายอดรวม โดยไม่มีอะไรอธิบายส่วนต่าง**
//      ซึ่งเป็นอาการเดียวกับที่ `9.22` ถูกสร้างมาแก้ (`receipt_unit_price` คือราคาป้าย
//      ก่อนหักราคาส่ง/โปร ส่วนต่างต้องไปโผล่เป็นบรรทัด "ส่วนลดราคาส่ง/โปรโมชั่น")
//
//   2. **เป็นทางพิมพ์สำรอง** — `/pos/restaurant` เคยมีทางพิมพ์ทางเดียวคือ WebUSB ESC/POS
//      ซึ่งใช้ได้เฉพาะ Chrome/Edge + HTTPS + ต้อง pair เครื่องก่อน (และบน macOS อาจต้อง
//      ถอน driver ของระบบ) · หน้าค้าปลีกตกไป print dialog ได้มาตลอด หน้าร้านอาหารไม่ได้
//      แปลว่าเครื่องพิมพ์ไม่ติด = ไม่มีทางได้กระดาษเลย ทั้งที่เป็นเอกสารที่ต้องให้ลูกค้า
//
// **ห้ามคำนวณเงินในไฟล์นี้** — ทุกตัวเลขมาจาก payload ที่ประกอบจากผลของ server เท่านั้น
// (กฎเดียวกับ `unitPriceForQty` ของ `8.1`: สูตรเงินชุดที่สองจะ drift แล้วจอกับกระดาษ
// จะเริ่มบอกคนละเลขโดยไม่มีใครรู้) · เรียงหัวข้อให้ตรงกับ `buildReceipt()` บรรทัดต่อบรรทัด
// เพราะสิ่งที่คนเห็นบนจอคือคำสัญญาว่ากระดาษจะออกมาแบบนี้
// =============================================================

import type { ReceiptPayload } from "@/lib/pos/escpos";
import { receiptLabel, receiptLocale } from "@/lib/pos/receiptI18n";

const money = (value: number, locale: string) =>
  value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** id คงที่เพราะกฎ `@media print` ใน globals.css เล็งที่ `#pos-receipt` (ใช้ร่วมกับหน้าค้าปลีก) */
export const RECEIPT_PRINT_ID = "pos-receipt";

export default function ReceiptPaper({ payload }: { payload: ReceiptPayload }) {
  const mode = payload.languageMode ?? "th";
  const locale = receiptLocale(mode);
  const label = (thai: string, english: string) => receiptLabel(mode, thai, english);
  const baht = (value: number) => money(value, locale);

  const Row = ({ left, right, strong }: { left: string; right: string; strong?: boolean }) => (
    <div className="pos-receipt-row" style={strong ? { fontWeight: 700 } : undefined}>
      <span>{left}</span><span>{right}</span>
    </div>
  );

  return (
    <div id={RECEIPT_PRINT_ID} className="pos-receipt-paper">
      <div className="pos-receipt-head">
        <b>{payload.storeName}</b>
        {payload.branchCode && <div>({label("สาขา", "Branch")} {payload.branchCode})</div>}
        {payload.taxId && <div>TAX#{payload.taxId}{payload.vatIncluded ? ` (${label("รวม VAT", "VAT Included")})` : ""}</div>}
        {payload.posNo && <div>POS#{payload.posNo}</div>}
        <div>{payload.docTitle}</div>
      </div>

      <div className="pos-receipt-rule" />
      {payload.lines.map((line, index) => (
        <Row key={`${line.name}-${index}`} left={`${line.qty} ${line.name}`}
          right={`${baht(line.amount)}${line.vatExempt ? "N" : ""}`} />
      ))}
      <div className="pos-receipt-rule" />

      {(payload.discountLines ?? []).filter((line) => line.amount > 0).map((line, index) => (
        <Row key={`${line.label}-${index}`} left={line.label} right={`-${baht(line.amount)}`} />
      ))}

      {payload.vat && <>
        <Row left={label("มูลค่าก่อน VAT", "Net before VAT")} right={baht(payload.vat.netBeforeVat)} />
        <Row left={`VAT ${payload.vat.rate}%`} right={baht(payload.vat.vatAmount)} />
        {Boolean(payload.vat.exemptAmount) && (
          <Row left={label("ยกเว้น VAT (N)", "VAT exempt (N)")} right={baht(payload.vat.exemptAmount!)} />
        )}
        {Boolean(payload.vat.roundingAmount) && (
          <Row left={label("ปัดเศษ", "Rounding")} right={baht(payload.vat.roundingAmount!)} />
        )}
      </>}

      <Row strong left={`${label("ยอดสุทธิ", "Total")} ${payload.itemCount} ${label("ชิ้น", "items")}`}
        right={baht(payload.total)} />
      {payload.paymentLabel && <Row left={label("ชำระโดย", "Paid by")} right={payload.paymentLabel} />}
      {payload.tendered != null && (
        <Row left={label("รับเงิน/เงินทอน", "Tendered/Change")}
          right={`${baht(payload.tendered)} / ${baht(payload.change ?? 0)}`} />
      )}

      <div className="pos-receipt-foot">
        <div>{payload.docNo ? `${payload.docNo}  ${payload.at}` : payload.at}</div>
        {payload.orderId && <div>Order {payload.orderId.slice(0, 8)}</div>}
        {payload.cashier && <div>{label("แคชเชียร์", "Cashier")} {payload.cashier}</div>}
      </div>

      {payload.member && <div className="pos-receipt-foot">
        {[payload.member.memberNo, payload.member.name].filter(Boolean).length > 0 && (
          <div>{label("สมาชิก", "Member")} {[payload.member.memberNo, payload.member.name].filter(Boolean).join(" ")}</div>
        )}
        {payload.member.pointsEarned != null && (
          <Row left={label("แต้มที่ได้บิลนี้", "Points earned")} right={`+${payload.member.pointsEarned}`} />
        )}
        {payload.member.pointsBalance != null && (
          <Row left={label("แต้มคงเหลือ", "Points balance")} right={String(payload.member.pointsBalance)} />
        )}
      </div>}
    </div>
  );
}
