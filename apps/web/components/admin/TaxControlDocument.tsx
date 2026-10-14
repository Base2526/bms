"use client";
import { formatTaxDate, taxIdentityLine } from "@/lib/bms/taxDocumentText";
/** Frozen server view shared by review and archive print. A preview is never printable as an issued document. */
export default function TaxControlDocument({ snapshot: s, preview = false }: { snapshot: any; preview?: boolean }) {
  const d = s.document;
  const money = (n: number) => Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!d) return <div><h3>สรุปปิดงวด / Period close — {s.month}</h3><p>ฉบับ / Version {s.version}</p><p>ฐานภาษี / Base {money(s.report?.grandTotal?.base)} · VAT {money(s.report?.grandTotal?.vat)} · รวม / Total {money(s.report?.grandTotal?.total)}</p><p>ภาษีซื้อ / Input VAT {money(s.purchaseReport?.totals?.vatAmount)}</p><p>{s.reason}</p></div>;
  const full = s.documentType === "FULL";
  return <article data-print-root={preview ? undefined : "tax-control-document"} style={{ color: "#111", background: "white", padding: 20, overflowWrap: "anywhere" }}>
    <h2>{preview ? "ตัวอย่างก่อนยืนยัน / PREVIEW" : s.action === "SUBSTITUTE" ? "ใบแทน / SUBSTITUTE" : "ต้นฉบับ / ORIGINAL"}</h2>
    <h3>{full ? "ใบกำกับภาษีเต็มรูป / Tax invoice" : s.documentType === "DEBIT_NOTE" ? "ใบเพิ่มหนี้ / Debit note" : "ใบลดหนี้ / Credit note"}</h3>
    <p>เลขที่ / No. {d.docNo ?? "กำหนดเมื่อยืนยัน / Assigned on confirmation"} · วันที่ / Date {formatTaxDate(d.issueDate, d.calendarEra)}</p>
    {s.action === "SUBSTITUTE" && <p>ใบแทนครั้งที่ / Substitute number {s.copyNumber} · วันที่ออกใบแทน / Issued {formatTaxDate(s.issueDate, d.calendarEra)}<br />เหตุผล / Reason {s.reason}</p>}
    {d.replacesDocNo && <p>ยกเลิกและออกใหม่แทนเอกสารเลขที่ / Replaces document {d.replacesDocNo}</p>}
    <p><b>ผู้ขาย / Seller: {d.seller.name}</b><br />{d.seller.address}<br />{taxIdentityLine(d.seller.taxId, d.seller.branchCode)}</p>
    <p><b>ผู้ซื้อ / Buyer: {d.buyer?.name ?? "—"}</b><br />{d.buyer?.address}<br />{taxIdentityLine(d.buyer?.taxId, d.buyer?.branchCode)}</p>
    {d.original && <p>อ้างอิงใบกำกับ / Original invoice {d.original.docNo} · {formatTaxDate(d.original.issueDate, d.calendarEra)}<br />เหตุผล / Reason {d.reason}</p>}
    <div className="tax-control-lines"><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th>รายการ / Description</th><th>จำนวน / Qty</th><th>หน่วย / Unit</th><th>มูลค่า / Amount</th></tr></thead><tbody>{d.lines?.map((l: any, index: number) => <tr key={index}><td>{l.name} {l.size}</td><td>{l.qty}</td><td>{l.unit}</td><td style={{ textAlign: "right" }}>{money(l.amount)}</td></tr>)}</tbody></table></div>
    <div style={{ textAlign: "right" }}>{full ? <>
      <p>รวมรายการ / Subtotal {money(d.subtotal)} · ส่วนลด / Discount {money(d.discount)} · ค่าส่ง / Shipping {money(d.shipping)}</p>
      <p>ก่อน VAT / Before VAT {money(d.netBeforeVat)} · ยกเว้น / Exempt {money(d.exemptAmount)}</p>
      <p>VAT {d.vatRate}% {money(d.vatAmount)} · ปัดเศษ / Rounding {money(d.roundingAmount)}</p><b>รวม / Total {money(d.grandTotal)}</b>
    </> : <>
      <p>มูลค่าเดิม / Original value {money(d.originalValue)}</p><p>ปรับลดสุทธิก่อนหน้า / Previous net credits {money(d.previouslyCredited)}</p>
      <p>มูลค่าที่ถูกต้อง / Correct value {money(d.correctValue)}</p><p>ผลต่าง / Difference {money(d.difference)}</p>
      <p>ผลต่างก่อน VAT / Difference before VAT {money(d.differenceBeforeVat)} · ยกเว้น / Exempt {money(d.exemptAmount)}</p><b>VAT {d.vatRate}% {money(d.vatAmount)}</b>
    </>}</div><p>{d.amountText}</p>
    <p>ผู้ออก / Issued by {s.actorName}</p><p>ลงลายมือชื่อ / Signature ____________________</p>
    <p>เอกสารกระดาษ ไม่ใช่ e-Tax Invoice / Paper document, not e-Tax</p>
    <style jsx>{`th,td { padding:6px; border-bottom:1px solid #ddd; } .tax-control-lines { overflow-x:auto; } table { min-width:440px; } @media print { .tax-control-lines { overflow:visible; } table { min-width:0; } thead { display:table-header-group; } tr { break-inside:avoid; } }`}</style>
  </article>;
}
