// =============================================================
// e-Tax Invoice — ประกอบ XML
// -------------------------------------------------------------
// ⚠️ อ่านก่อนใช้: XML ที่ไฟล์นี้สร้าง **ยังไม่ได้ตรวจกับสเปกจริงของกรมสรรพากร**
//
// มาตรฐานที่ RD ใช้อ้างอิงคือ ขมธ.๑๔ ซึ่งอิง UN/CEFACT Cross Industry Invoice
// โครงด้านล่างวางตามรูปทรงนั้น (ExchangedDocument / SupplyChainTradeTransaction)
// แต่ชื่อ element ที่ถูกต้อง ลำดับที่บังคับ และ code list ต้องอ่านจากเอกสาร
// ตัวจริง ซึ่งไม่มีในเครื่องนี้ตอนเขียน
//
// อย่าเชื่อว่าใช้ส่งได้จนกว่าจะ validate กับ XSD ของ RD — ถือว่าไฟล์นี้เป็น
// "โครงที่ถูกต้องทางความหมาย" ไม่ใช่ "เอกสารที่ผ่านการตรวจ"
//
// สิ่งที่ตรวจแล้วว่าถูก: การ escape อักขระ, ตัวเลขทศนิยม 2 ตำแหน่ง,
// การแยกกลุ่ม VAT/ยกเว้น และการอ้างเลขใบย่อที่ถูกยกเลิก
// =============================================================

import type { EtaxDocumentData } from "./types";

/** & < > " ' ต้อง escape ทั้งหมด — ชื่อร้าน/สินค้าไทยมี & ได้จริง */
export function esc(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(n: number): string {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** รหัสประเภทเอกสารตาม ขมธ.๑๔ — ต้องยืนยันกับเอกสาร RD ก่อนใช้จริง */
const DOC_TYPE_CODE: Record<EtaxDocumentData["docType"], string> = {
  ABBREVIATED: "T02", // ใบกำกับภาษีอย่างย่อ
  FULL: "T03", // ใบกำกับภาษี
  CREDIT_NOTE: "T04", // ใบลดหนี้
};

/** รหัสประเภทภาษี: VAT 7% / ยกเว้น */
function taxTypeCode(cat: "V" | "N" | "UNKNOWN"): string {
  return cat === "N" ? "FRE" : "VAT";
}

export function buildEtaxXml(doc: EtaxDocumentData): string {
  const lines = doc.lines
    .map(
      (l) => `      <IncludedSupplyChainTradeLineItem>
        <AssociatedDocumentLineDocument>
          <LineID>${esc(l.lineNo)}</LineID>
        </AssociatedDocumentLineDocument>
        <SpecifiedTradeProduct>
          <SellerAssignedID>${esc(l.sku)}</SellerAssignedID>
          <Name>${esc(l.name)}</Name>
        </SpecifiedTradeProduct>
        <SpecifiedLineTradeAgreement>
          <NetPriceProductTradePrice>
            <ChargeAmount>${num(l.unitPrice)}</ChargeAmount>
          </NetPriceProductTradePrice>
        </SpecifiedLineTradeAgreement>
        <SpecifiedLineTradeDelivery>
          <BilledQuantity unitCode="${esc(l.unitName ?? "EA")}">${esc(l.qty)}</BilledQuantity>
        </SpecifiedLineTradeDelivery>
        <SpecifiedLineTradeSettlement>
          <ApplicableTradeTax>
            <TypeCode>${taxTypeCode(l.vatCategory)}</TypeCode>
          </ApplicableTradeTax>
          <SpecifiedTradeSettlementLineMonetarySummation>
            <LineTotalAmount>${num(l.amount)}</LineTotalAmount>
          </SpecifiedTradeSettlementLineMonetarySummation>
        </SpecifiedLineTradeSettlement>
      </IncludedSupplyChainTradeLineItem>`
    )
    .join("\n");

  // กลุ่มยกเว้น VAT ต้องแยกเป็น ApplicableTradeTax คนละก้อน ไม่ใช่รวมกับกลุ่ม 7%
  // (ใบ Makro ที่ใช้อ้างอิงแยก V กับ N ชัดเจน)
  const taxBlocks = [
    doc.taxableAmount > 0
      ? `        <ApplicableTradeTax>
          <CalculatedAmount>${num(doc.vatAmount)}</CalculatedAmount>
          <TypeCode>VAT</TypeCode>
          <BasisAmount>${num(doc.taxableAmount - doc.vatAmount)}</BasisAmount>
          <RateApplicablePercent>${num(doc.vatRate)}</RateApplicablePercent>
        </ApplicableTradeTax>`
      : "",
    doc.exemptAmount > 0
      ? `        <ApplicableTradeTax>
          <CalculatedAmount>0.00</CalculatedAmount>
          <TypeCode>FRE</TypeCode>
          <BasisAmount>${num(doc.exemptAmount)}</BasisAmount>
          <RateApplicablePercent>0.00</RateApplicablePercent>
        </ApplicableTradeTax>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // ใบเต็มที่ออกแทนใบย่อต้องอ้างเลขใบเดิม — ทุกใบจริงที่ดูมามีข้อความนี้
  const replaces = doc.replacesDocNo
    ? `    <ReferencedDocument>
      <IssuerAssignedID>${esc(doc.replacesDocNo)}</IssuerAssignedID>
      <TypeCode>${DOC_TYPE_CODE.ABBREVIATED}</TypeCode>
    </ReferencedDocument>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<CrossIndustryInvoice>
  <ExchangedDocument>
    <ID>${esc(doc.docNo)}</ID>
    <TypeCode>${DOC_TYPE_CODE[doc.docType]}</TypeCode>
    <IssueDateTime>${esc(doc.issueDate)}</IssueDateTime>
${doc.operatorId ? `    <OperatorID>${esc(doc.operatorId)}</OperatorID>\n` : ""}${replaces}
  </ExchangedDocument>
  <SupplyChainTradeTransaction>
${lines}
    <ApplicableHeaderTradeAgreement>
      <SellerTradeParty>
        <Name>${esc(doc.seller.name)}</Name>
        <SpecifiedTaxRegistration>
          <ID schemeID="TXID">${esc(doc.seller.taxId)}</ID>
          <BranchID>${esc(doc.seller.branchCode)}</BranchID>
        </SpecifiedTaxRegistration>
        <PostalTradeAddress>
          <LineOne>${esc(doc.seller.address)}</LineOne>
        </PostalTradeAddress>
      </SellerTradeParty>
      <BuyerTradeParty>
        <Name>${esc(doc.buyer.name)}</Name>
${doc.buyer.taxId
      ? `        <SpecifiedTaxRegistration>
          <ID schemeID="TXID">${esc(doc.buyer.taxId)}</ID>
          <BranchID>${esc(doc.buyer.branchCode ?? "00000")}</BranchID>
        </SpecifiedTaxRegistration>\n`
      : ""}        <PostalTradeAddress>
          <LineOne>${esc(doc.buyer.address)}</LineOne>
        </PostalTradeAddress>
      </BuyerTradeParty>
    </ApplicableHeaderTradeAgreement>
    <ApplicableHeaderTradeSettlement>
      <InvoiceCurrencyCode>THB</InvoiceCurrencyCode>
${taxBlocks}
      <SpecifiedTradeSettlementHeaderMonetarySummation>
        <LineTotalAmount>${num(doc.taxableAmount + doc.exemptAmount - doc.vatAmount)}</LineTotalAmount>
        <TaxBasisTotalAmount>${num(doc.taxableAmount - doc.vatAmount)}</TaxBasisTotalAmount>
        <TaxTotalAmount>${num(doc.vatAmount)}</TaxTotalAmount>
        <GrandTotalAmount>${num(doc.grandTotal)}</GrandTotalAmount>
      </SpecifiedTradeSettlementHeaderMonetarySummation>
    </ApplicableHeaderTradeSettlement>
  </SupplyChainTradeTransaction>
</CrossIndustryInvoice>`;
}

/**
 * ตรวจสิ่งที่ตรวจได้เองก่อนส่ง — ไม่ใช่การ validate กับ XSD ของ RD
 * แต่กันข้อผิดพลาดที่เจอบ่อยและปลายทางจะปฏิเสธแน่ ๆ
 */
export function validateEtaxDocument(doc: EtaxDocumentData): string[] {
  const errors: string[] = [];
  if (!doc.docNo?.trim()) errors.push("ไม่มีเลขที่เอกสาร");
  if (!doc.seller.taxId?.trim()) errors.push("ร้านยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษี");
  if (!doc.seller.branchCode?.trim()) errors.push("ร้านยังไม่ได้ตั้งรหัสสาขา (ภ.พ.20)");
  if (doc.lines.length === 0) errors.push("เอกสารไม่มีรายการสินค้า");
  if (doc.lines.some((l) => l.vatCategory === "UNKNOWN")) {
    errors.push("มีสินค้าที่ยังไม่ระบุประเภท VAT");
  }
  // ใบกำกับเต็มรูปต้องมีผู้ซื้อ — ใบย่อไม่ต้อง
  if (doc.docType === "FULL") {
    if (!doc.buyer.name?.trim()) errors.push("ใบกำกับเต็มรูปต้องมีชื่อผู้ซื้อ");
    if (!doc.buyer.taxId?.trim()) errors.push("ใบกำกับเต็มรูปต้องมีเลขประจำตัวผู้เสียภาษีผู้ซื้อ");
  }
  const sum = Math.round((doc.taxableAmount + doc.exemptAmount) * 100) / 100;
  const total = Math.round(doc.grandTotal * 100) / 100;
  if (Math.abs(sum - total) > 0.01) {
    errors.push(`ยอดไม่สมดุล: กลุ่มภาษี ${sum} ไม่เท่ากับยอดรวม ${total}`);
  }
  return errors;
}
