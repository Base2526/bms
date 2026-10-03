import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { buildInputVatReportDoc, buildXlsx, buildCsv } from "../apps/web/lib/bms/documentGenerator.ts";
import type { InputVatReport } from "../apps/web/lib/bms/expenseDocuments.ts";
const XLSX = createRequire(new URL("../apps/web/package.json", import.meta.url))("xlsx");

function fixture(): InputVatReport {
  return {
    buyer: { name: "FAKE buyer", taxId: "0105555555554" },
    period: { from: "2026-10-01", to: "2026-10-31" },
    establishments: [
      { locationId: "hq", code: "MAIN", name: "FAKE HQ", branchCode: "00000", isHeadOffice: true, address: "FAKE HQ address" },
      { locationId: "br", code: "BR1", name: "FAKE branch", branchCode: "00002", isHeadOffice: false, address: "FAKE branch address" },
    ],
    rows: ["hq", "br"].map((locationId, i) => ({
      locationId, branchCode: i ? "00002" : "00000", documentDate: "2026-10-04", documentNo: `FAKE-${i}`,
      payeeName: "FAKE supplier", payeeTaxId: "0105555555554", payeeBranchCode: i ? "00000" : "00054",
      amountBeforeVat: i ? -100 : 200, vatAmount: i ? -7 : 14, totalAmount: i ? -107 : 214, note: i ? "ใบลดหนี้" : "",
    })),
    totals: { documentCount: 2, amountBeforeVat: 100, vatAmount: 7, totalAmount: 107 },
  };
}

test("all-establishment purchase rows use our buyer location, never the supplier branch, in XLSX/CSV", () => {
  const doc = buildInputVatReportDoc(fixture(), v => v, { includeBuyerEstablishment: true });
  const sheets = doc.sheets.filter(s => s.taxPrintIdentity);
  assert.deepEqual(sheets.map(s => [s.rows[0].payeeEstablishment, s.rows[0].buyerHeadOffice, s.rows[0].buyerBranch]), [
    ["00054", "00000", ""], ["00000", "", "00002"],
  ]);
  const workbook = XLSX.read(buildXlsx(doc), { type: "buffer", cellNF: true });
  for (const [index, sheet] of sheets.entries()) {
    assert.equal(sheet.columns.length, 11);
    assert.deepEqual(sheet.headerRows![0].slice(5, 8), ["สถานประกอบการผู้ขาย", "สถานประกอบการผู้ซื้อ (ร้านเรา)", ""]);
    assert.deepEqual(sheet.headerRows![1].slice(6, 8), ["สำนักงานใหญ่", "สาขา"]);
    assert.deepEqual(sheet.footer![1].slice(7), index ? ["รวมทั้งสิ้น", -100, -7, ""] : ["รวมทั้งสิ้น", 200, 14, ""]);
    const ws = workbook.Sheets[sheet.name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
    const header = rows.findIndex(r => r[0] === "ลำดับที่");
    assert.deepEqual(rows[header + 2].slice(5, 10), index ? ["00000", "", "00002", -100, -7] : ["00054", "00000", "", 200, 14]);
    assert.ok(ws["!merges"].some((m: any) => m.s.r === header && m.e.r === header && m.s.c === 6 && m.e.c === 7));
    assert.equal(ws[XLSX.utils.encode_cell({ r: header + 2, c: index ? 7 : 6 })].t, "s");
    for (const c of [8, 9]) {
      const cell = ws[XLSX.utils.encode_cell({ r: header + 2, c })];
      assert.equal(cell.t, "n"); assert.equal(cell.z, "#,##0.00");
    }
  }
  assert.match(buildCsv(doc).toString("utf8"), /00000,,00002,-100,-7/);
});

test("single purchase establishment keeps compact layout; all selection with one allowed branch keeps buyer columns", () => {
  const report = fixture();
  report.establishments = report.establishments.slice(1); report.rows = report.rows.slice(1);
  for (const includeBuyerEstablishment of [false, true]) {
    const sheets = buildInputVatReportDoc(report, v => v, { includeBuyerEstablishment }).sheets.filter(s => s.taxPrintIdentity);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].columns.length, includeBuyerEstablishment ? 11 : 9);
    assert.equal(sheets[0].rows[0].buyerBranch, includeBuyerEstablishment ? "00002" : undefined);
    assert.equal(sheets[0].rows[0].payeeEstablishment, "00000");
  }
});

test("empty input-VAT branches keep identity, grouped heading and correctly aligned zero totals", () => {
  const report = fixture(); report.rows = [];
  report.totals = { documentCount: 0, amountBeforeVat: 0, vatAmount: 0, totalAmount: 0 };
  const doc = buildInputVatReportDoc(report, v => v, { includeBuyerEstablishment: true });
  const workbook = XLSX.read(buildXlsx(doc), { type: "buffer" });
  for (const sheet of doc.sheets.filter(s => s.taxPrintIdentity)) {
    assert.equal(sheet.includeWhenEmpty, true);
    assert.ok(workbook.Sheets[sheet.name]);
    assert.deepEqual(sheet.footer![1].slice(7), ["รวมทั้งสิ้น", 0, 0, ""]);
  }
});

test("both input-VAT exports and interactive print use the actual location selection", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/reportEngine.ts", import.meta.url), "utf8");
  assert.match(source, /includeBuyerEstablishment: !locationId/);
  assert.match(source, /includeBuyerEstablishment: !input.locationId/);
});
