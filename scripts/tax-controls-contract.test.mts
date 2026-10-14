import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { normalizeTaxBuyer } from "../apps/web/lib/bms/taxBuyer.ts";
import { buildTaxDocNo, creditNotePrefix, fullInvoicePrefix } from "../apps/web/lib/bms/taxDocumentNumber.ts";
import { taxAmountsOf } from "../apps/web/lib/bms/taxReportMath.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tenant = "11111111-1111-4111-8111-111111111111", location = "22222222-2222-4222-8222-222222222222", docId = "33333333-3333-4333-8333-333333333333";
const actor = "44444444-4444-4444-8444-444444444444";
const buyer = { name: "FAKE buyer", address: "FAKE address", buyerType: "INDIVIDUAL", vatRegistered: false };
function harness() {
  const calls: { sql: string; params: any[] }[] = [];
  const state: any = { balance: { taxable: 0, exempt: 0, vat: 0, total: 0, count: 0 }, replay: null, hidden: false, returned: false, external: false, auditFail: false, allowed: true, version: 1, exceptions: 0 };
  const view: any = { id: docId, docNo: "FAKE-FULL", issueDate: "2026-09-15", calendarEra: "BE", seller: { name: "FAKE seller", taxId: "0105555555554", branchCode: "00000", address: "FAKE seller address" }, buyer: { ...buyer, taxId: null, branchCode: null }, lines: [], grandTotal: 157, vatAmount: 7 };
  const document: any = { id: docId, location_id: location, order_id: "order", doc_type: "FULL", doc_no: "FAKE-FULL", issue_date: "2026-09-15", grand_total: 157, taxable_amount: 107, exempt_amount: 50, vat_amount: 7, vat_rate: 7, rounding_amount: 0, cancelled_at: null };
  const report: any = { seller: { calendarEra: "BE" }, rows: [], totals: [], grandTotal: { total: 157, vat: 7 }, exceptionCounts: {} };
  const client = { release() {}, query: async (sql: string, params: any[] = []) => {
    calls.push({ sql, params }); let rows: any[] = [];
    if (sql.includes("SELECT id,request_hash")) rows = state.replay ? [state.replay] : [];
    else if (sql.includes("SELECT name FROM users")) rows = [{ name: "FAKE staff" }];
    else if (sql.includes("FOR UPDATE OF o")) rows = state.hidden ? [] : [{ id: "order", status: "COMPLETED", voided_at: null }];
    else if (sql.includes("SELECT * FROM bms_tax_documents")) rows = [document];
    else if (sql.includes("SELECT 1 FROM bms_pos_returns")) rows = state.returned ? [{}] : [];
    else if (sql.includes("FROM bms_etax_submissions")) rows = state.external ? [{}] : [];
    else if (sql.includes("COALESCE(SUM(CASE WHEN doc_type='DEBIT_NOTE'")) rows = [state.balance];
    else if (sql.includes("MAX(copy_number)")) rows = [{ n: 2 }];
    else if (sql.includes("MAX(version)")) rows = [{ version: state.version }];
    else if (sql.includes("INSERT INTO bms_tax_documents")) rows = [{ id: "new-document" }];
    else if (/INSERT INTO bms_tax_(document_actions|period_snapshots)/.test(sql)) rows = [{ id: "action-id" }];
    else if (sql.includes("INSERT INTO bms_audit_log") && state.auditFail) throw new Error("FAKE audit failure");
    return { rows, rowCount: rows.length };
  }};
  const source = ts.transpileModule(read("apps/web/lib/bms/taxDocumentControls.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  const permissionCalls: string[] = [];
  new Function("require", "exports", source)((id: string) => {
    if (id === "crypto") return requireCrypto;
    if (id === "@/lib/db") return { getClient: async () => client };
    if (id === "./tenant") return { getTenantId: () => tenant, beginTenantTx: async () => { await client.query("BEGIN"); } };
    if (id === "./permissions") return {
      requirePermission: async (_: any, p: string) => { permissionCalls.push(p); if (!state.allowed || (p === "expense.view" && state.readPurchase === false)) throw new Error("FORBIDDEN"); },
      loadPermissions: async () => new Set(state.readPurchase === false ? [] : ["expense.view"]),
    };
    if (id === "./locations") return { listLocationsForUser: async () => [{ id: location }] };
    if (id === "./taxBuyer") return { normalizeTaxBuyer };
    if (id === "./taxDocuments") return { getFullTaxInvoiceView: async () => view, getCreditNoteView: async () => view,
      nextSequenceInTx: async () => 12, taxClockInTx: async () => ({ isoDate: "2026-10-14", year: 2026, month: 10, day: 14 }), taxDocLocationInTx: async () => ({ isHeadOffice: true, branchCode: "00000" }), pgDateToIso: (v: any) => String(v).slice(0,10) };
    if (id === "./taxDocumentNumber") return { buildTaxDocNo, creditNotePrefix, fullInvoicePrefix };
    if (id === "./taxReports") return { getSalesTaxReport: async () => ({ ...report, exceptionCounts: { bad: state.exceptions } }) };
    if (id === "./expenseDocuments") return { getInputVatReport: async () => ({ rows: [], totals: { vatAmount: 3.5 } }) };
    if (id === "./etax/queue") return { cancelQueuedTaxDocumentInTx: async () => { await client.query("CANCEL ETAX"); } };
    if (id === "./vat") return { bahtText: () => "FAKE amount text" };
    throw new Error(`Unexpected dependency ${id}`);
  }, exports);
  return { ...exports, calls, state, view, document, permissionCalls, ctx: { admin: { id: actor } } };
}
import * as requireCrypto from "node:crypto";
const request = (action = "CREDIT") => ({ action, documentId: docId, idempotencyKey: "FAKE-key", reason: "FAKE price error item A", evidence: "FAKE customer request", base: 50, exempt: 0, eventDate: "2026-10-10" });

test("VAT registration is independent from legal personality; legacy inputs remain strict", () => {
  assert.equal(normalizeTaxBuyer({ ...buyer, buyerType: "COMPANY", vatRegistered: false }).branchCode, null);
  const registered = normalizeTaxBuyer({ ...buyer, vatRegistered: true, taxId: "0105555555554", branchCode: "00002" });
  assert.equal(registered.branchCode, "00002");
  for (const patch of [{ vatRegistered: true }, { vatRegistered: "true" }, { taxId: "0105555555555" }, { buyerType: "OTHER" }]) assert.throws(() => normalizeTaxBuyer({ ...buyer, ...patch }));
  assert.throws(() => normalizeTaxBuyer({ name: "FAKE", address: "FAKE" }));
});
test("amounts use satang precision and validate adjustment event date", () => {
  const h = harness();
  assert.deepEqual(h.adjustmentAmounts({ base: 100, exempt: 25 }, 7), { taxable: 107, exempt: 25, vat: 7, total: 132 });
  for (const base of [-1, NaN, Infinity, 0.001, "100"]) assert.throws(() => h.adjustmentAmounts({ base, exempt: 0 }, 7));
  for (const date of ["2026-02-30", "2026-08-31", "2026-10-15"]) assert.throws(() => h.assertAdjustmentEventDate(date, "2026-10-14", "FAKE"));
  assert.throws(() => h.assertAdjustmentEventDate("2026-09-30", "2026-10-14", ""));
  assert.equal(h.assertAdjustmentEventDate("2026-09-30", "2026-10-14", "FAKE delay"), "2026-09-30");
  assert.deepEqual(taxAmountsOf({ docType: "DEBIT_NOTE", taxableAmount: 107, exemptAmount: 0, vatAmount: 7, roundingAmount: 0 }), { base: 100, exempt: 0, vat: 7, total: 107, rounding: 0 });
});
test("preview writes nothing; confirm rechecks the balance; credit/debit audit and document commit together", async () => {
  for (const action of ["CREDIT", "DEBIT"]) {
    const h = harness(), input = request(action);
    const preview = await h.executeTaxControl(h.ctx, input);
    assert.equal(preview.status, "PREVIEW"); assert.equal(preview.snapshot.document.vatAmount, 3.5);
    assert.ok(!h.calls.some((c: any) => /INSERT|UPDATE bms_/.test(c.sql)));
    assert.equal(h.permissionCalls[0], "tax.document.adjust");
    h.calls.length = 0;
    const result = await h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: preview.reviewHash });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.snapshot.document.correctValue, action === "CREDIT" ? 103.5 : 210.5);
    assert.ok(h.calls.some((c: any) => c.sql.includes("INSERT INTO bms_audit_log")));
    assert.equal(h.calls.at(-1).sql, "COMMIT");
    assert.ok(!h.calls.some((c: any) => /UPDATE bms_(orders|inventory|ar_)|INSERT INTO bms_payments/.test(c.sql)));
  }
});
test("stale review, missing confirmation, cumulative over-credit, return and external submission cannot mutate", async () => {
  for (const flag of ["stale", "overcredit", "returned", "external", "hidden", "cancelled"]) {
    const h = harness(), input = request(), p = await h.executeTaxControl(h.ctx, input); h.calls.length = 0;
    if (flag === "stale") h.state.balance = { taxable: -10.7, exempt: 0, vat: -0.7, total: -10.7, count: 1 };
    if (flag === "overcredit") h.state.balance = { taxable: -100, exempt: 0, vat: -6.54, total: -100, count: 1 };
    if (["returned", "external", "hidden"].includes(flag)) h.state[flag] = true;
    if (flag === "cancelled") h.document.cancelled_at = "2026-10-12";
    await assert.rejects(h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: p.reviewHash }));
    assert.ok(!h.calls.some((c: any) => c.sql.startsWith("INSERT")), flag);
    assert.ok(h.calls.some((c: any) => c.sql === "ROLLBACK"));
  }
});
test("audit failure rolls back, and committed idempotent retries never issue twice", async () => {
  const h = harness(), input = request(), p = await h.executeTaxControl(h.ctx, input);
  h.state.auditFail = true; h.calls.length = 0;
  await assert.rejects(h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: p.reviewHash }), /FAKE audit failure/);
  assert.ok(!h.calls.some((c: any) => c.sql === "COMMIT")); assert.equal(h.calls.at(-1).sql, "ROLLBACK");
  const insert = h.calls.find((c: any) => c.sql.includes("INSERT INTO bms_tax_document_actions"));
  h.state.replay = { id: "action-id", location_id: location, request_hash: insert.params[6], snapshot: JSON.parse(insert.params[12]) };
  h.calls.length = 0;
  assert.equal((await h.executeTaxControl(h.ctx, input)).status, "COMPLETED");
  assert.ok(!h.calls.some((c: any) => c.sql.startsWith("INSERT")));
  await assert.rejects(h.executeTaxControl(h.ctx, { ...input, base: 40 }), /Idempotency conflict/);
});
test("substitute captures a numbered copy without modifying the invoice", async () => {
  const h = harness(), input = request("SUBSTITUTE"), p = await h.executeTaxControl(h.ctx, input);
  const result = await h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: p.reviewHash });
  assert.equal(result.snapshot.copyNumber, 2); assert.equal(result.snapshot.document.docNo, "FAKE-FULL");
  assert.equal(result.snapshot.issueDate, "2026-10-14");
  assert.ok(!h.calls.some((c: any) => /(?:INSERT INTO|UPDATE) bms_tax_documents/.test(c.sql)));
});
test("buyer correction preserves original document date and financial values and records the recovered original", async () => {
  const h = harness(), input = { ...request("CORRECT"), buyer, originalReturned: true };
  await assert.rejects(h.executeTaxControl(h.ctx, { ...input, originalReturned: false }), /original was recovered/);
  const p = await h.executeTaxControl(h.ctx, input);
  const result = await h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: p.reviewHash });
  assert.equal(result.snapshot.document.issueDate, "2026-09-15");
  assert.equal(result.snapshot.document.grandTotal, 157);
  assert.equal(result.snapshot.document.replacesDocNo, "FAKE-FULL");
  assert.equal(result.snapshot.originalDocument.docNo, "FAKE-FULL");
});
test("period archives include input/output VAT, reject open months/exceptions and preserve prior versions", async () => {
  const h = harness(), input = { ...request("CLOSE"), month: "2026-09", locationId: location };
  await assert.rejects(h.executeTaxControl(h.ctx, { ...input, month: "2026-10" }), /Only completed months/);
  h.state.exceptions = 1;
  await assert.rejects(h.executeTaxControl(h.ctx, input), /Resolve report exceptions/);
  h.state.exceptions = 0;
  const p = await h.executeTaxControl(h.ctx, input);
  assert.equal(p.snapshot.purchaseReport.totals.vatAmount, 3.5);
  assert.ok(h.permissionCalls.includes("expense.view"));
  const r = await h.executeTaxControl(h.ctx, { ...input, confirmed: true, reviewHash: p.reviewHash });
  assert.equal(r.snapshot.version, 1);
  h.state.version = 2;
  const next = await h.executeTaxControl(h.ctx, { ...input, idempotencyKey: "new-key" });
  assert.equal(next.snapshot.version, 2);
  assert.ok(!h.calls.some((c: any) => /UPDATE bms_tax_period|DELETE/.test(c.sql)));
});
test("permission denial happens before acquiring the transaction or reading buyer details", async () => {
  const h = harness(); h.state.allowed = false;
  await assert.rejects(h.executeTaxControl(h.ctx, request()), /FORBIDDEN/);
  assert.equal(h.calls.length, 0);
});
test("period history and downloads repeat purchase-source permission; a different branch remains hidden", async () => {
  const h = harness(); h.state.readPurchase = false;
  const list = await h.listTaxControls(h.ctx, "2026-09", location);
  assert.deepEqual(list.periods, []);
  assert.ok(!h.calls.some((c: any) => c.sql.includes("bms_tax_period_snapshots")));
  h.calls.length = 0;
  await assert.rejects(h.readTaxControlArchive(h.ctx, docId, true), /FORBIDDEN/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.listTaxControls(h.ctx, "2026-09", actor), /Not found/);
  assert.equal(h.calls.length, 0);
});
test("migration ledgers are tenant-isolated and append-only; adapters guard themselves and provider backfill excludes paper adjustments", () => {
  const sql = read("db/migrations/10.60__bms_tax_document_controls.sql");
  assert.match(sql, /FORCE ROW LEVEL SECURITY/); assert.match(sql, /WITH CHECK/);
  assert.match(sql, /REVOKE UPDATE, DELETE/); assert.match(sql, /UNIQUE \(tenant_id, idempotency_key\)/);
  const route = read("apps/web/app/api/bms/tax-controls/route.ts");
  assert.equal((route.match(/authorizeAdminRoute\("tax.document.view"\)/g) ?? []).length, 2);
  assert.match(route, /req.headers.get\("origin"\) !== req.nextUrl.origin/);
  assert.match(read("apps/web/lib/bms/etax/queue.ts"), /adjustment_kind IS NULL AND d.doc_type <> 'DEBIT_NOTE'/);
  const pos = read("apps/web/lib/bms/pos.ts"); assert.match(pos, /adjustment_kind='PRICE'[\s\S]*TAX_ADJUSTMENT_REVIEW_REQUIRED/);
});

test("the real sales report retains original values through replacement chains and signs debit/credit notes once", async () => {
  const { getSalesTaxReport } = await import("../apps/web/lib/bms/taxReports.ts");
  const row = { location_id: location, branch_code: "00000", device_id: "device", device_code: "POS", issue_date: "2026-09-15", issued_at: "2026-09-15T10:00:00Z", cancelled_at: null, cancelled_reason: null, buyer_name: "FAKE", buyer_tax_id: null, buyer_branch_code: null, replaces_document_id: null, reference_doc_no: null, taxable_amount: 107, exempt_amount: 0, vat_amount: 7, rounding_amount: 0, grand_total: 107 };
  const rows = [
    { ...row, doc_type: "ABBREVIATED", doc_no: "A", cancelled_at: "2026-09-16", active_replacement_doc_no: "F" },
    { ...row, doc_type: "FULL", doc_no: "F", cancelled_at: "2026-09-17", replaces_document_id: "A", active_replacement_doc_no: "F2" },
    { ...row, doc_type: "FULL", doc_no: "F2", replaces_document_id: "F" },
    { ...row, doc_type: "DEBIT_NOTE", doc_no: "D", taxable_amount: 10.7, vat_amount: 0.7, grand_total: 10.7 },
    { ...row, doc_type: "CREDIT_NOTE", doc_no: "C", taxable_amount: 5.35, vat_amount: 0.35, grand_total: 5.35 },
  ];
  const reader = { query: async (sql: string) => {
    let result: any[] = [];
    if (sql.includes("SELECT vat_registered")) result = [{ vat_registered: false, calendar_era: "BE" }];
    else if (sql.includes("SELECT t.name")) result = [{ name: "FAKE", tax_id: "0105555555554" }];
    else if (sql.includes("SELECT id, code, name")) result = [{ id: location, branch_code: "00000", is_head_office: true }];
    else if (sql.includes("SELECT d.doc_type")) result = rows;
    else if (sql.includes("FROM bms_tax_document_actions")) result = [{ action: "SUBSTITUTE", copy_number: 1, reason: "FAKE lost", issue_date: "2026-09-20", actor_name: "FAKE staff", location_id: location, branch_code: "00000", doc_no: "F2" }];
    else throw new Error(`Unexpected report SQL ${sql}`);
    return { rows: result, rowCount: result.length };
  }};
  const report = await getSalesTaxReport(tenant, { from: "2026-09-01", to: "2026-09-30", allowedLocationIds: [location] }, reader as any);
  assert.equal(report.grandTotal.base, 105);
  assert.equal(report.grandTotal.vat, 7.35);
  assert.equal(report.grandTotal.total, 112.35);
  assert.equal(report.rows.find(r => r.docNoFrom === "F2" && r.kind === "FULL")?.total, 0);
  assert.equal(report.rows.find(r => r.kind === "DOCUMENT_EVENT")?.total, 0);
});

test("REST refuses unauthenticated, unauthorized, cross-origin and malformed commands before the service", async () => {
  let auth: any = { ok: false, status: 401 }, calls = 0, malformed = false;
  class FakeResponse extends Response { static json(data: unknown, init?: ResponseInit) { return new Response(JSON.stringify(data), init); } }
  class BodyError extends Error { status = 400; }
  const exports: any = {};
  const js = ts.transpileModule(read("apps/web/app/api/bms/tax-controls/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", js)((id: string) => {
    if (id === "next/server") return { NextResponse: FakeResponse };
    if (id === "crypto") return requireCrypto;
    if (id.endsWith("adminRouteAuth")) return { authorizeAdminRoute: async () => auth };
    if (id.endsWith("taxDocumentControls")) return { executeTaxControl: async () => { calls++; return { status: "PREVIEW" }; }, TaxControlError: BodyError };
    if (id.endsWith("retailLocalRequestBody")) return { readRetailLocalJSON: async () => { if (malformed) throw new BodyError("Invalid body"); return {}; }, RetailLocalRequestBodyError: BodyError };
    if (["documentGenerator", "taxReportPrint", "taxReportMath"].some(name => id.endsWith(name))) return {};
    throw new Error(id);
  }, exports);
  const req = (origin = "http://127.0.0.1:3107") => ({ headers: new Headers({ origin }), nextUrl: new URL("http://127.0.0.1:3107/api/bms/tax-controls") });
  assert.equal((await exports.POST(req())).status, 401);
  auth = { ok: false, status: 403 }; assert.equal((await exports.POST(req())).status, 403);
  auth = { ok: true, ctx: {} }; assert.equal((await exports.POST(req("https://untrusted.invalid"))).status, 403);
  malformed = true; assert.equal((await exports.POST(req())).status, 400); assert.equal(calls, 0);
  malformed = false; const result = await exports.POST(req()); assert.equal(result.status, 200); assert.equal(calls, 1);
});
