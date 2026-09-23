// =============================================================
// รายงานภาษี — pure contract (ไม่ต้องมี DB)
// -------------------------------------------------------------
// ตัวเลข golden คำนวณมือ:
//   ใบกำกับ 107.00 (taxable รวม VAT) · VAT 7.00 → ฐาน 100.00
//   ใบลดหนี้ 53.50 · VAT 3.50 → ฐาน −50.00 · VAT −3.50 · รวม −53.50
// =============================================================

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  assertTaxPeriod,
  formatTaxDate,
  sumTaxAmounts,
  taxAmountsOf,
  taxMonthOf,
} from "../apps/web/lib/bms/taxReportMath.ts";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

test("an invoice's base excludes VAT; VAT is not counted twice", () => {
  const a = taxAmountsOf({ docType: "ABBREVIATED", taxableAmount: 107, exemptAmount: 0, vatAmount: 7, roundingAmount: 0 });
  assert.deepEqual(a, { base: 100, exempt: 0, vat: 7, total: 107, rounding: 0 });
});

test("a credit note is negative on every column", () => {
  const n = taxAmountsOf({ docType: "CREDIT_NOTE", taxableAmount: 53.5, exemptAmount: 0, vatAmount: 3.5, roundingAmount: 0 });
  // ศูนย์ต้องเป็น 0 ไม่ใช่ -0 (Excel แสดง -0 ให้คนอ่านสะดุด)
  assert.deepEqual(n, { base: -50, exempt: 0, vat: -3.5, total: -53.5, rounding: 0 });
  assert.ok(!Object.is(n.exempt, -0));
});

test("exempt sales and cash rounding are reported separately from the VAT base", () => {
  // ข้าวสาร 50 (ยกเว้น) + สินค้า 107 (รวม VAT) ปัดเศษ -0.25
  const a = taxAmountsOf({ docType: "FULL", taxableAmount: 107, exemptAmount: 50, vatAmount: 7, roundingAmount: -0.25 });
  assert.equal(a.base, 100);
  assert.equal(a.exempt, 50);
  assert.equal(a.total, 157, "total excludes cash rounding");
  assert.equal(a.rounding, -0.25);
});

test("sums do not drift on binary floating point", () => {
  // 0.1 + 0.2 ≠ 0.3 ใน JS — ยอดรวมภาษีต้องปัดทุกขั้น
  const parts = Array.from({ length: 3 }, () =>
    taxAmountsOf({ docType: "ABBREVIATED", taxableAmount: 0.1, exemptAmount: 0, vatAmount: 0, roundingAmount: 0 }));
  parts.push(taxAmountsOf({ docType: "ABBREVIATED", taxableAmount: 0.2, exemptAmount: 0, vatAmount: 0, roundingAmount: 0 }));
  assert.equal(sumTaxAmounts(parts).base, 0.5);
  assert.deepEqual(sumTaxAmounts([]), { base: 0, exempt: 0, vat: 0, total: 0, rounding: 0 });
});

test("dates are shown as DD/MM/YYYY in the shop's calendar era", () => {
  assert.equal(formatTaxDate("2026-10-01", "BE"), "01/10/2569");
  assert.equal(formatTaxDate("2026-10-01", "CE"), "01/10/2026");
  assert.equal(taxMonthOf("2026-10-01"), "2026-10");
});

test("report periods are validated", () => {
  assert.deepEqual(assertTaxPeriod("2026-09-01", "2026-09-30"), { from: "2026-09-01", to: "2026-09-30" });
  assert.throws(() => assertTaxPeriod("2026-9-1", "2026-09-30"));
  assert.throws(() => assertTaxPeriod("2026-09-30", "2026-09-01"));
  assert.throws(() => assertTaxPeriod("2024-01-01", "2026-01-01"));
});

test("every report type in code is allowed by the latest DB CHECK (the 9.95 failure)", () => {
  const engine = read("apps/web/lib/bms/reportEngine.ts");
  const block = /export const REPORT_TYPES = \[([\s\S]*?)\] as const/.exec(engine);
  assert.ok(block);
  const types = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(types.includes("VAT_SALES"));

  const dir = new URL("db/migrations/", root);
  const num = (f: string) => f.split("__")[0].split(".").map(Number);
  const files = readdirSync(dir)
    .filter((f) => /^\d+\.\d+__.*\.sql$/.test(f))
    .sort((a, b) => { const [a1, a2] = num(a); const [b1, b2] = num(b); return a1 - b1 || a2 - b2; });
  let allowed: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8").replace(/--.*$/gm, "");
    const m = /ADD CONSTRAINT bms_generated_reports_report_type_check\s+CHECK\s*\(\s*report_type IN \(([\s\S]*?)\)\s*\)/.exec(sql);
    if (m) allowed = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
  }
  assert.ok(allowed, "no migration defines the report type CHECK");
  for (const t of types) assert.ok(allowed.includes(t), `${t} is generated but the DB CHECK rejects it`);
});

test("the sales tax report cannot be exported as a PDF that renders Thai as blank boxes", () => {
  const engine = read("apps/web/lib/bms/reportEngine.ts");
  assert.ok(/THAI_ONLY_REPORT_TYPES[\s\S]{0,80}"VAT_SALES"/.test(engine));
  assert.ok(/format === "PDF" && THAI_ONLY_REPORT_TYPES\.has\(reportType\)/.test(engine));
  // และไม่ส่งตัวเลขภาษีไปให้ AI สรุป
  assert.ok(/THAI_ONLY_REPORT_TYPES\.has\(reportType\) \? false/.test(engine));
});

test("tax periods are cut by the Thai issue_date, never by the UTC issued_at", () => {
  const src = read("apps/web/lib/bms/taxReports.ts").replace(/--.*$/gm, "");
  assert.ok(!/d\.issued_at\s*(>=|<|BETWEEN)/.test(src));
  assert.equal((src.match(/d\.issue_date BETWEEN \$2::date AND \$3::date/g) ?? []).length, 3);
  // ค้นด้วยคำที่มี % ต้องไม่กลายเป็น wildcard
  assert.ok(/replace\(\/\[\\\\%_\]\/g/.test(src));
});

test("the tax document page is behind tax.document.view", () => {
  const gql = read("apps/web/graphql/bmsTaxReports.ts");
  assert.equal((gql.match(/requirePermission\(ctx, "tax\.document\.view"\)/g) ?? []).length, 3);
});
