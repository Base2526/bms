import PDFDocument from "pdfkit";
import path from "node:path";
import type { FullTaxInvoiceView } from "./taxDocuments";
import { formatTaxDate, taxIdentityLine } from "./taxDocumentText";

/** Render the issued snapshot; never recompute tax or fetch current product prices. */
export async function renderTaxInvoicePdf(invoice: FullTaxInvoiceView): Promise<Buffer> {
  // Set the initial font too: bundled PDFKit cannot resolve its default Helvetica AFM file.
  const font = path.join(process.cwd(), "public/fonts/sarabun/Sarabun-Regular.ttf");
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true,
    font,
    info: { Title: `Tax invoice copy ${invoice.docNo}`, Author: "BMS" } });
  const parts: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => parts.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 80;
  const bottom = doc.page.height - 65;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = (value: string, size = 11) => {
    doc.fontSize(size);
    doc.text(value, 40, doc.y, { width, lineGap: 3 });
    doc.moveDown(0.4);
  };
  text("สำเนาใบกำกับภาษีเต็มรูป", 18);
  text("สำเนาสำหรับตรวจสอบ - ไม่ใช่ e-Tax Invoice - ติดต่อร้านเพื่อรับต้นฉบับ", 10);
  text(`เลขที่ ${invoice.docNo}   วันที่ ${formatTaxDate(invoice.issueDate, invoice.calendarEra)}`);
  if (invoice.replacesDocNo) text(`ยกเลิกและออกใหม่แทนเอกสาร ${invoice.replacesDocNo}`, 10);
  for (const [label, party] of [["ผู้ขาย", invoice.seller], ["ผู้ซื้อ", invoice.buyer]] as const) {
    const identity = taxIdentityLine(party.taxId, party.branchCode);
    text(`${label}: ${party.name}\n${party.address}${identity ? `\n${identity}` : ""}${party.phone ? `\nโทร ${party.phone}` : ""}`);
  }
  const columns = [40, 295, 342, 388, 471];
  const widths = [247, 39, 38, 75, width - 431];
  const row = (values: string[], header = false) => {
    doc.fontSize(10);
    const height = Math.max(...values.map((value, i) => doc.heightOfString(value, { width: widths[i] }))) + 12;
    if (doc.y + height > bottom) {
      doc.addPage();
      text(`สำเนาใบกำกับภาษี ${invoice.docNo} (ต่อ)`, 12);
      if (!header) row(["รายการ", "จำนวน", "หน่วย", "ราคา/หน่วย", "มูลค่า"], true);
    }
    const y = doc.y;
    values.forEach((value, i) => doc.text(value, columns[i], y + 4, { width: widths[i], align: i === 0 || i === 2 ? "left" : "right" }));
    doc.moveTo(40, y + height).lineTo(40 + width, y + height).strokeColor("#dddddd").stroke();
    doc.y = y + height + 3;
  };
  row(["รายการ", "จำนวน", "หน่วย", "ราคา/หน่วย", "มูลค่า"], true);
  for (const line of invoice.lines) row([
    `${line.name}${line.size && line.size !== "-" ? ` (${line.size})` : ""}`,
    String(line.qty), line.unit, money(line.unitPrice), money(line.amount),
  ]);
  if (doc.y + 230 > bottom) doc.addPage();
  doc.moveDown();
  for (const [label, value] of [
    ["รวมรายการ", invoice.subtotal], ["ส่วนลดท้ายบิล", invoice.discount], ["ค่าจัดส่ง", invoice.shipping],
    ["ยอดก่อน VAT", invoice.netBeforeVat], ["มูลค่ายกเว้น VAT", invoice.exemptAmount],
    [`VAT ${invoice.vatRate}%`, invoice.vatAmount], ["ปัดเศษ", invoice.roundingAmount], ["รวมทั้งสิ้น (บาท)", invoice.grandTotal],
  ] as const) {
    doc.fontSize(11).text(`${label}   ${money(value)}`, 40, doc.y, { width, align: "right" });
  }
  doc.moveDown();
  text(invoice.amountText);
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    // Footer sits outside the body margin; PDFKit must not flow it onto a new page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(9).text(`${invoice.docNo}   |   ${page + 1} / ${pages.count}`, 40, doc.page.height - 50, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return complete;
}
