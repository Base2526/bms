import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { renderTaxInvoicePdf } from "../apps/web/lib/bms/taxInvoicePdf.ts";
const party = { name: "FAKE บริษัท ทดสอบภาษาไทย จำกัด", taxId: "0105555555554", branchCode: "00000",
  address: "99/9 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10140", phone: "020000000", locationName: "สำนักงานใหญ่" };
const pdf = await renderTaxInvoicePdf({ id: "FAKE", orderId: "FAKE", docNo: "FAKE-INV-001", issueDate: "2026-10-12",
  seller: party, buyer: party, replacesDocNo: "FAKE-ABB-001",
  lines: Array.from({ length: 60 }, (_, i) => ({ sku: `FAKE-${i}`, name: `สินค้า ${i + 1} สำหรับทดสอบภาษาไทยและตัวเลข ${i % 10 === 0 ? "ข้อความยาว ".repeat(8) : ""}`,
    size: "XL", qty: 1, unit: "ชิ้น", unitPrice: 107, amount: 107 })),
  subtotal: 6420, discount: 0, shipping: 0, netBeforeVat: 6000, exemptAmount: 0, vatAmount: 420, vatRate: 7,
  roundingAmount: 0, grandTotal: 6420, amountText: "หกพันสี่ร้อยยี่สิบบาทถ้วน",
});
assert.equal([...pdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length, 4, "60 rows fit four numbered pages without blank footer pages");
const directory = new URL("../.test-output/tax-invoice-pdf/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("sample.pdf", directory), pdf);
console.log(`PDF smoke: ${pdf.length} bytes`);
