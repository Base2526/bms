"use client";
import type { FullTaxInvoiceView } from "@/lib/bms/taxDocuments";
export default function TaxInvoiceCopy({
  invoice: i,
}: {
  invoice: FullTaxInvoiceView;
}) {
  const money = (n: number) =>
    n.toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const branch = (s: string) => (s === "00000" ? "สำนักงานใหญ่" : `สาขา ${s}`);
  return (
    <article data-print-root="tax-invoice-copy"
      style={{
        color: "#111",
        background: "white",
        padding: 24,
        marginTop: 16,
        overflowWrap: "anywhere",
      }}
    >
      <h2>สำเนาใบกำกับภาษีเต็มรูป</h2>
      <p>
        สำเนาสำหรับตรวจสอบ — ไม่ใช่ e-Tax Invoice · ติดต่อร้านเพื่อรับต้นฉบับ
      </p>
      <p>
        เลขที่ {i.docNo} · วันที่ {i.issueDate}
        {i.replacesDocNo && ` · ออกแทนใบอย่างย่อ ${i.replacesDocNo}`}
      </p>
      <p>
        <b>ผู้ขาย: {i.seller.name}</b>
        <br />
        {i.seller.address}
        <br />
        เลขผู้เสียภาษี {i.seller.taxId} · {branch(i.seller.branchCode)}
      </p>
      <p>
        <b>ผู้ซื้อ: {i.buyer.name}</b>
        <br />
        {i.buyer.address}
        <br />
        เลขผู้เสียภาษี {i.buyer.taxId} · {branch(i.buyer.branchCode)}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>รายการ</th>
            <th>จำนวน</th>
            <th>หน่วย</th>
            <th>ราคา/หน่วย</th>
            <th>มูลค่า</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l, n) => (
            <tr key={n}>
              <td>
                {l.name}
                {l.size && l.size !== "-" ? ` (${l.size})` : ""}
              </td>
              <td style={{ textAlign: "right" }}>{l.qty}</td>
              <td>{l.unit}</td>
              <td style={{ textAlign: "right" }}>{money(l.unitPrice)}</td>
              <td style={{ textAlign: "right" }}>{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: "right" }}>
        รวมรายการ {money(i.subtotal)}<br />
        ส่วนลดท้ายบิล {money(i.discount)}<br />
        ค่าจัดส่ง {money(i.shipping)}<br />
        ยอดก่อน VAT {money(i.netBeforeVat)}
        <br />
        VAT {i.vatRate}%: {money(i.vatAmount)}
        <br />
        ปัดเศษ {money(i.roundingAmount)}
        <br />
        <b>รวมทั้งสิ้น {money(i.grandTotal)} บาท</b>
      </p>
      <p>{i.amountText}</p>
      <style jsx>{`
        th, td { padding: 3px; vertical-align: top; }
        th:not(:first-child), td:not(:first-child) { white-space: nowrap; }
        @media screen and (max-width: 600px) { table { font-size: 12px; } }
        @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }
      `}</style>
    </article>
  );
}
