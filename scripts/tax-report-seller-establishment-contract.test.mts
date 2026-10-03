import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { buildSalesTaxReportDoc, buildXlsx, buildCsv } from "../apps/web/lib/bms/documentGenerator.ts";
import type { SalesTaxReport } from "../apps/web/lib/bms/taxReports.ts";
const XLSX = createRequire(new URL("../apps/web/package.json", import.meta.url))("xlsx");

function fixture(): SalesTaxReport {
  const amounts = { base: 100, exempt: 0, vat: 7, total: 107, rounding: 0 };
  return {
    seller: { name: "FAKE seller", taxId: "0105555555554", vatRegistered: true, calendarEra: "BE" },
    period: { from: "2026-10-01", to: "2026-10-31" },
    establishments: [
      { locationId: "hq", code: "MAIN", name: "FAKE HQ", branchCode: "00000", isHeadOffice: true, address: "FAKE HQ address" },
      { locationId: "br", code: "BR1", name: "FAKE branch", branchCode: "00002", isHeadOffice: false, address: "FAKE branch address" },
    ],
    rows: ["hq", "br"].map((locationId, i) => ({
      ...amounts, kind: "FULL", issueDate: "2026-10-04", locationId, branchCode: i ? "00002" : "00000",
      deviceCode: null, docNoFrom: `FAKE-${i}`, docNoTo: `FAKE-${i}`, docCount: 1, cancelledCount: 0,
      buyerName: "FAKE buyer", buyerTaxId: "0105555555554", buyerBranchCode: i ? "00000" : "00054", referenceDocNo: null,
    })),
    totals: ["hq", "br"].map((locationId, i) => ({ ...amounts, locationId, branchCode: i ? "00002" : "00000", documentCount: 1 })),
    grandTotal: { base: 200, exempt: 0, vat: 14, total: 214, rounding: 0, documentCount: 2 },
    exceptions: [], cancelled: [], exceptionCounts: { PAID_WITHOUT_TAX_DOCUMENT: 0, RETURN_WITHOUT_CREDIT_NOTE: 0, FULL_REPLACES_OTHER_MONTH: 0 },
  };
}

test("all-establishment sales sheets distinguish the seller from the buyer without moving tax totals", () => {
  const doc = buildSalesTaxReportDoc(fixture(), v => v, { includeSellerEstablishment: true });
  const sheets = doc.sheets.filter(s => s.taxPrintIdentity);
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map(s => [s.rows[0].buyerEstablishment, s.rows[0].sellerHeadOffice, s.rows[0].sellerBranch]), [
    ["00054", "00000", ""], ["00000", "", "00002"],
  ]);
  const workbook = XLSX.read(buildXlsx(doc), { type: "buffer", cellNF: true });
  for (const [index, sheet] of sheets.entries()) {
    assert.equal(sheet.columns.length, 11);
    assert.deepEqual(sheet.headerRows![0].slice(5, 8), ["สถานประกอบการผู้ซื้อ", "สถานประกอบการผู้ขาย (ร้านเรา)", ""]);
    assert.deepEqual(sheet.headerRows![1].slice(6, 8), ["สำนักงานใหญ่", "สาขา"]);
    assert.deepEqual(sheet.footer![1].slice(7), ["รวมทั้งสิ้น", 100, 7, ""]);
    const ws = workbook.Sheets[sheet.name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
    const header = rows.findIndex(r => r[0] === "ลำดับที่");
    assert.deepEqual(rows[header + 2].slice(5, 10), index ? ["00000", "", "00002", 100, 7] : ["00054", "00000", "", 100, 7]);
    assert.ok(ws["!merges"].some((m: any) => m.s.r === header && m.e.r === header && m.s.c === 6 && m.e.c === 7));
    assert.equal(ws[XLSX.utils.encode_cell({ r: header + 2, c: index ? 7 : 6 })].t, "s", "leading zero branch codes stay text");
    for (const c of [8, 9]) {
      const cell = ws[XLSX.utils.encode_cell({ r: header + 2, c })];
      assert.equal(cell.t, "n"); assert.equal(cell.z, "#,##0.00");
    }
  }
  assert.match(buildCsv(doc).toString("utf8"), /00054,00000,,100,7/);
});

test("explicit single branch keeps original form; all selection with one permitted branch still has seller columns", () => {
  const report = fixture();
  report.establishments = report.establishments.slice(1);
  report.rows = report.rows.slice(1); report.totals = report.totals.slice(1);
  for (const includeSellerEstablishment of [false, true]) {
    const sheets = buildSalesTaxReportDoc(report, v => v, { includeSellerEstablishment }).sheets.filter(s => s.taxPrintIdentity);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].columns.length, includeSellerEstablishment ? 11 : 9);
    assert.equal(sheets[0].rows[0].sellerBranch, includeSellerEstablishment ? "00002" : undefined);
    assert.equal(sheets[0].rows[0].buyerEstablishment, "00000");
  }
});

test("both saved exports and interactive print use the actual location filter for seller columns", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/reportEngine.ts", import.meta.url), "utf8");
  assert.match(source, /includeSellerEstablishment: !locationId/);
  assert.match(source, /includeSellerEstablishment: !input.locationId/);
});
