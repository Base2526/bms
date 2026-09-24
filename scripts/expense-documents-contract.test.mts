import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

test("expense documents are tenant-owned financial evidence, never hard-deleted", () => {
  const sql = read("db/migrations/10.11__bms_expense_documents.sql");
  assert.match(sql, /UNIQUE \(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, location_id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, supplier_id\)[\s\S]*?SET NULL \(supplier_id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, purchase_order_id\)[\s\S]*?SET NULL \(purchase_order_id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, evidence_file_id\)[\s\S]*?SET NULL \(evidence_file_id\)/);
  assert.match(sql, /status\s+TEXT NOT NULL DEFAULT 'ACTIVE'.*'VOID'/);
  assert.doesNotMatch(read("apps/web/lib/bms/expenseDocuments.ts"), /DELETE FROM bms_expense_documents/);
});

test("input VAT and withholding evidence fail closed in the database", () => {
  const sql = read("db/migrations/10.11__bms_expense_documents.sql");
  assert.match(sql, /vat_amount = 0 OR document_kind = 'TAX_INVOICE'/);
  assert.match(sql, /document_no IS NOT NULL[\s\S]*payee_tax_id IS NOT NULL/);
  assert.match(sql, /\(vat_amount > 0\) = \(vat_claim_month IS NOT NULL\)/);
  assert.match(sql, /wht_amount > 0[\s\S]*wht_rate IS NOT NULL[\s\S]*payee_type IS NOT NULL[\s\S]*paid_at IS NOT NULL/);
  assert.match(sql, /WHERE status = 'ACTIVE' AND document_kind = 'TAX_INVOICE'/);
});

test("expense input rejects impossible dates and unknown withholding classifications before SQL", () => {
  const src = read("apps/web/lib/bms/expenseDocuments.ts");
  assert.match(src, /isIsoCalendarDate\(input\.documentDate\)/);
  assert.match(src, /isOneOf\(payeeType, EXPENSE_PAYEE_TYPES\)/);
  assert.match(src, /isOneOf\(whtIncomeType, EXPENSE_WHT_TYPES\)/);
  assert.match(src, /whtRate > 100/);
});

test("the tax feature never disables Electron download checksum verification", () => {
  const pkg = read("apps/desktop/package.json");
  assert.doesNotMatch(pkg, /unsafelyDisableChecksums/);
});

test("expense mutations use exact idempotency and transactional audit", () => {
  const src = read("apps/web/lib/bms/expenseDocuments.ts");
  assert.match(src, /request_hash/);
  assert.match(src, /request_hash !== requestHash/);
  assert.match(src, /runInTransaction\(actorUserId/);
  assert.match(src, /expense\.document\.create/);
  assert.match(src, /expense\.document\.void/);
  assert.match(src, /FOR UPDATE/);
  assert.match(src, /pg_advisory_xact_lock/, "concurrent same-key retries must serialize before the replay read");
  const page = read("apps/web/app/(admin)/admin/expenses/page.tsx");
  assert.match(page, /idempotencyKey:createKey/);
  assert.doesNotMatch(page, /idempotencyKey:crypto\.randomUUID\(\)/, "a UI retry must reuse the action key");
});

test("tax summaries use each authority date instead of forcing every figure into document month", () => {
  const src = read("apps/web/lib/bms/expenseDocuments.ts");
  assert.match(src, /sum\(vat_amount\) FILTER \(WHERE vat_claim_month BETWEEN/);
  assert.match(src, /sum\(wht_amount\) FILTER \(WHERE paid_at BETWEEN/);
  assert.match(src, /sum\(amount_before_vat\) FILTER \(WHERE document_date BETWEEN/);
});

test("expense GraphQL reads and writes have separate permissions", () => {
  const gql = read("apps/web/graphql/bmsExpenseDocuments.ts");
  assert.equal((gql.match(/requirePermission\(ctx, "expense\.view"\)/g) ?? []).length, 4);
  assert.equal((gql.match(/requirePermission\(ctx, "expense\.manage"\)/g) ?? []).length, 2);
  const nav = read("apps/web/lib/bms/adminNavigation.ts");
  assert.match(nav, /route: "\/admin\/expenses"[\s\S]{0,120}ctx\.can\("expense\.view"\)/);
});

test("an evidence file must already be private and owned by the same tenant", () => {
  const src = read("apps/web/lib/bms/expenseDocuments.ts");
  assert.match(src, /FROM files WHERE id=\$1 AND tenant_id=\$2/);
  assert.match(src, /COALESCE\(visibility,'private'\)='private'/);
});

test("expense reads and mutations honour the actor's branch scope", () => {
  const gql = read("apps/web/graphql/bmsExpenseDocuments.ts");
  const service = read("apps/web/lib/bms/expenseDocuments.ts");
  assert.match(gql, /listLocationsForUser/);
  assert.match(gql, /userCanAccessLocation/);
  assert.match(service, /allowedLocationIds/);
  assert.match(service, /location_id\s*=\s*ANY\(\$8\)/);
  assert.match(service, /location_id=ANY\(\$3\)[\s\S]*FOR UPDATE/);
});
