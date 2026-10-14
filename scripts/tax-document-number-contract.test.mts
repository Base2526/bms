// =============================================================
// เลขและวันที่ของเอกสารภาษี — pure contract (ไม่ต้องมี DB)
// -------------------------------------------------------------
// ตรึงสองบั๊กที่ทำให้ตัวเลขภาษีขายผิด:
//  1. วันที่ของเอกสารต้องเป็นวันที่ไทย ไม่ใช่วันที่ของเครื่อง (container รันเป็น UTC)
//  2. เลขเอกสารต้องไม่ชนกันข้ามเครื่อง/ข้ามสาขา เพราะ doc_no unique ทั้งร้าน
//     แต่ตัวนับรันแยกต่อเครื่อง/ต่อสาขา
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  abbreviatedInvoicePrefix,
  buildTaxDocNo,
  creditNotePrefix,
  fullInvoicePrefix,
  taxClockOf,
} from "../apps/web/lib/bms/taxDocumentNumber.ts";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

test("00:30 Thai time on the 1st is the 1st, not the last day of the previous month", () => {
  // 2026-09-30T17:30Z = 2026-10-01 00:30 in Bangkok
  const clock = taxClockOf(new Date("2026-09-30T17:30:00Z"));
  assert.deepEqual(clock, { isoDate: "2026-10-01", year: 2026, month: 10, day: 1 });
});

test("the day boundary is Thai midnight, independent of the host clock", () => {
  assert.equal(taxClockOf(new Date("2026-09-30T16:59:59Z")).isoDate, "2026-09-30");
  assert.equal(taxClockOf(new Date("2026-09-30T17:00:00Z")).isoDate, "2026-10-01");
  // ปีใหม่ไทยเริ่มตอนเที่ยงคืนไทย — ตัวนับรายปีต้องรีเซ็ตตรงนี้ ไม่ใช่ 07:00 น.
  assert.equal(taxClockOf(new Date("2026-12-31T17:00:00Z")).year, 2027);
  assert.equal(taxClockOf(new Date("2026-12-31T16:59:59Z")).year, 2026);
});

test("an invalid instant is rejected rather than printed as NaN", () => {
  assert.throws(() => taxClockOf(new Date("not a date")));
});

test("document number keeps the existing yyMMdd + 4-digit format", () => {
  const clock = taxClockOf(new Date("2026-09-23T03:00:00Z"));
  assert.equal(buildTaxDocNo(null, clock, 4, "BE"), "6909230004");
  assert.equal(buildTaxDocNo(null, clock, 4, "CE"), "2609230004");
  assert.equal(buildTaxDocNo("KFC", clock, 12345, "BE"), "KFC69092312345");
});

test("head office numbers are unchanged; branches get their branch code", () => {
  const hq = { isHeadOffice: true, branchCode: "00000" };
  const branch = { isHeadOffice: false, branchCode: "00001" };
  assert.equal(fullInvoicePrefix(hq), null);
  assert.equal(creditNotePrefix(hq), "CN");
  assert.equal(fullInvoicePrefix(branch), "00001-");
  assert.equal(creditNotePrefix(branch), "CN00001-");

  const clock = taxClockOf(new Date("2026-09-23T03:00:00Z"));
  const hqNo = buildTaxDocNo(fullInvoicePrefix(hq), clock, 1, "BE");
  const branchNo = buildTaxDocNo(fullInvoicePrefix(branch), clock, 1, "BE");
  assert.notEqual(hqNo, branchNo, "first FULL invoice of the year at two locations on the same day must differ");
});

test("a register with its own unique prefix keeps it; shared prefixes get the device code", () => {
  assert.equal(
    abbreviatedInvoicePrefix({ receiptPrefix: "A", code: "POS-01", sharedWithAnotherDevice: false }),
    "A"
  );
  assert.equal(
    abbreviatedInvoicePrefix({ receiptPrefix: null, code: "POS-01", sharedWithAnotherDevice: false }),
    null
  );
  const a = abbreviatedInvoicePrefix({ receiptPrefix: null, code: "POS-01", sharedWithAnotherDevice: true });
  const b = abbreviatedInvoicePrefix({ receiptPrefix: null, code: "POS-02", sharedWithAnotherDevice: true });
  assert.equal(a, "POS-01-");
  assert.notEqual(a, b);
  assert.equal(
    abbreviatedInvoicePrefix({ receiptPrefix: " X ", code: "POS-02", sharedWithAnotherDevice: true }),
    "XPOS-02-"
  );
  assert.equal(
    abbreviatedInvoicePrefix({ receiptPrefix: " X ", code: "POS-01", sharedWithAnotherDevice: false }),
    "X",
    "a unique configured prefix must not put accidental spaces into an immutable document number"
  );
});

test("taxDocuments.ts no longer reads the host clock for dates or numbers", () => {
  const src = withoutComments(read("apps/web/lib/bms/taxDocuments.ts"));
  assert.ok(!/new Date\(\)/.test(src), "tax documents must take their date from the transaction clock");
  assert.ok(!/periodKey:\s*String\(now\./.test(src), "period keys must come from the Thai tax clock");
  assert.equal((src.match(/periodKey:\s*String\(clock\.year\)/g) ?? []).length, 3);
  assert.ok(!/toISOString\(\)\.slice\(0,\s*10\)/.test(src), "DATE columns must not be read with toISOString()");
  // ทั้งสามเส้นทางต้องเขียน issue_date เอง ไม่พึ่ง DEFAULT
  const inserts = src.match(/INSERT INTO bms_tax_documents[\s\S]*?RETURNING \*/g) ?? [];
  assert.equal(inserts.length, 3, "expected three tax-document INSERTs (abbreviated, full, credit note)");
  for (const sql of inserts) {
    assert.ok(/[(,]\s*issue_date\s*,/.test(sql), `INSERT must list issue_date as a column:\n${sql}`);
    assert.ok(/\$\d+::date/.test(sql), `INSERT must bind issue_date from the tax clock:\n${sql}`);
  }
});

test("every issuer derives its prefix from the collision-safe helpers", () => {
  const src = withoutComments(read("apps/web/lib/bms/taxDocuments.ts"));
  assert.ok(/abbreviatedInvoicePrefix\(/.test(src));
  assert.ok(/buildTaxDocNo\(fullInvoicePrefix\(location\)/.test(src));
  assert.ok(/buildTaxDocNo\(creditNotePrefix\(location\)/.test(src));
  assert.ok(!/buildTaxDocNo\(null,/.test(src), "no issuer may build a number without a prefix decision");
  assert.ok(!/buildTaxDocNo\("CN",/.test(src), "credit notes must include the branch code");
});

test("the e-Tax loader reads issue_date as text and names the seller from bms_tenants", () => {
  const src = withoutComments(read("apps/web/lib/bms/etax/queue.ts"));
  assert.ok(/d\.issue_date::text/.test(src));
  assert.ok(!/toISOString\(\)\.slice\(0,\s*10\)/.test(src));
  assert.ok(/JOIN bms_tenants t ON t\.id = d\.tenant_id/.test(src));
  assert.ok(/name: d\.seller_name/.test(src));
});

test("management report treats credit notes as negative", () => {
  const src = read("apps/web/lib/bms/reports.ts");
  assert.ok(/CASE WHEN d\.doc_type = 'CREDIT_NOTE' THEN -d\.grand_total ELSE d\.grand_total END/.test(src));
  assert.ok(/AND d\.doc_type <> 'CREDIT_NOTE'[\s\S]{0,400}AS tax_document_count/.test(src));
});

test("a failed credit note opens an incident instead of only logging", () => {
  const src = read("apps/web/lib/bms/pos.ts");
  const start = src.indexOf("async function ensurePosReturnCreditNote");
  const end = src.indexOf("export async function processPosReturn");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.equal((body.match(/code: "tax\.credit_note_failed"/g) ?? []).length, 2);
  assert.ok(/"tax\.credit_note_failed": \{/.test(read("apps/web/lib/bms/failureAlert.ts")),
    "reportBmsFailure drops codes missing from FAILURE_CATALOG silently");
});
