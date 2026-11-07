import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";
import { parseBankStatementBuffer } from "../apps/web/lib/bms/bankStatementFormat.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

test("CSV parser normalizes Thai bank rows without losing direction or satang", () => {
  const csv = [
    "วันที่,เวลา,รายละเอียด,เลขอ้างอิง,เดบิต,เครดิต,ยอดคงเหลือ",
    "06/11/2569,09:30,รับโอนสินค้า,TX-001,,1,234.56,12,000.50",
  ].join("\n");
  // Real CSV needs quotes around comma-formatted amounts.
  const parsed = parseBankStatementBuffer(
    Buffer.from(csv.replace(",1,234.56,12,000.50", ',"1,234.56","12,000.50"')),
    "statement.csv",
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].postedOn, "2026-11-06");
  assert.equal(parsed.rows[0].direction, "IN");
  assert.equal(parsed.rows[0].amount, "1234.56");
  assert.equal(parsed.rows[0].balanceAfter, "12000.50");
  assert.match(parsed.rows[0].fingerprint, /^[0-9a-f]{64}$/);
});

test("parser rejects formula-bearing workbooks", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Description", "Credit", "Balance"],
    ["2026-11-06", "transfer", 100, 100],
  ]);
  sheet.C2 = { t: "n", v: 100, f: "50+50" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  assert.throws(
    () => parseBankStatementBuffer(buffer, "statement.xlsx"),
    /สูตร/,
  );
});

test("parser validates Buddhist ISO dates and preserves legitimate duplicate rows", () => {
  const csv = [
    "วันที่,รายละเอียด,เครดิต",
    "2569-11-06,โอนซ้ำ,100.00",
    "2569-11-06,โอนซ้ำ,100.00",
    "2569-02-30,วันที่ผิด,10.00",
  ].join("\n");
  const first = parseBankStatementBuffer(Buffer.from(csv), "statement.csv");
  const second = parseBankStatementBuffer(Buffer.from(csv), "statement.csv");
  assert.equal(first.rows.length, 2);
  assert.equal(first.rows[0].postedOn, "2026-11-06");
  assert.notEqual(first.rows[0].fingerprint, first.rows[1].fingerprint);
  assert.deepEqual(
    first.rows.map((row) => row.fingerprint),
    second.rows.map((row) => row.fingerprint),
  );
  assert.match(first.warnings.join(" "), /วันที่ไม่ถูกต้อง/);
});

test("parser keeps 18,2 money exact without JavaScript floating-point rounding", () => {
  const csv = [
    "วันที่,รายละเอียด,เครดิต,ยอดคงเหลือ",
    '2026-11-06,ยอดใหญ่,"0.01","9,999,999,999,999,999.99"',
  ].join("\n");
  const parsed = parseBankStatementBuffer(Buffer.from(csv), "large.csv");
  assert.equal(parsed.rows[0].amount, "0.01");
  assert.equal(parsed.rows[0].balanceAfter, "9999999999999999.99");
  assert.equal(parsed.openingBalance, "9999999999999999.98");
});

test("migration is additive, tenant isolated, and source tables remain untouched", () => {
  const migration = source("db/migrations/10.110__bms_bank_reconciliation.sql");
  for (const table of [
    "bms_bank_accounts",
    "bms_bank_statement_imports",
    "bms_bank_statement_entries",
    "bms_bank_reconciliation_links",
    "bms_bank_reconciliation_periods",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /tenant_id = NULLIF\(current_setting\('bms\.tenant_id'/,
  );
  assert.doesNotMatch(migration, /USING \(tenant_id = COALESCE/);
  assert.match(migration, /REVOKE UPDATE, DELETE ON/);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE bms_(payments|ar_receipts|expense_documents|pos_refund_allocations|delivery_settlements)\b/,
  );
});

test("reads are tenant-scoped and match confirmation locks before taking its serializable snapshot", () => {
  const service = source("apps/web/lib/bms/bankReconciliation.ts");
  assert.match(service, /queryBankReconciliation/);
  assert.match(service, /beginTenantTx\(client, tenantId\)/);
  const lock = service.indexOf("pg_advisory_lock");
  const serializable = service.indexOf("serializable: true", lock);
  const candidateRead = service.indexOf(
    "listCandidates(tenantId, entryId, client)",
    serializable,
  );
  assert.ok(lock >= 0 && serializable > lock && candidateRead > serializable);
});

test("rollout defaults off everywhere and private files cannot use the generic route", () => {
  for (const compose of [
    "docker-compose.yml",
    "docker-compose.dev.yml",
    "docker-compose.prod.yml",
  ]) {
    const body = source(compose);
    assert.match(
      body,
      /BMS_BANK_RECONCILIATION_ENABLED:\s*\$\{BMS_BANK_RECONCILIATION_ENABLED:-false\}/,
    );
    assert.match(
      body,
      /NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED:\s*\$\{NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED:-false\}/,
    );
    assert.match(
      body,
      /BMS_BANK_FINGERPRINT_SECRET:\s*\$\{BMS_BANK_FINGERPRINT_SECRET:-\$\{JWT_SECRET\}\}/,
    );
  }
  assert.match(
    source("apps/web/app/api/files/[id]/route.ts"),
    /bank-statement-/,
  );
  assert.match(
    source(
      "apps/web/app/api/bms/bank-reconciliation/imports/[id]/file/route.ts",
    ),
    /bank_reconciliation\.view/,
  );
  assert.match(
    source("apps/web/lib/bms/bankReconciliation.ts"),
    /createHmac\("sha256", secret\)/,
  );
});

test("sensitive GraphQL mutations require explicit confirmation and scoped permissions", () => {
  const resolver = source("apps/web/graphql/bmsBankReconciliation.ts");
  for (const permission of [
    "bank_reconciliation.view",
    "bank_reconciliation.import",
    "bank_reconciliation.review",
    "bank_reconciliation.close",
  ]) {
    assert.match(resolver, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(resolver, /confirmed: Boolean!/);
  assert.match(resolver, /requireConfirmed\(a\.confirmed\)/);
  assert.doesNotMatch(
    source("apps/web/lib/bms/bankReconciliation.ts"),
    /UPDATE bms_(payments|ar_receipts|expense_documents|pos_refund_allocations|delivery_settlements)\b/,
  );
  assert.match(resolver, /unexpectedDatabaseError/);
  assert.match(resolver, /INTERNAL_SERVER_ERROR/);
});

test("large money stays exact in review and export", () => {
  const page = source(
    "apps/web/app/(admin)/admin/bank-reconciliation/page.tsx",
  );
  const exportRoute = source(
    "apps/web/app/api/bms/bank-reconciliation/export/route.ts",
  );
  assert.match(page, /const moneyCents =/);
  assert.match(page, /<InputNumber<string>[\s\S]*?stringMode/);
  assert.doesNotMatch(
    page,
    /Number\(selectedEntry(?:\?|\.)?(?:amount|matchedAmount)/,
  );
  assert.doesNotMatch(exportRoute, /Number\(r\.(?:amount|balance_after|matched_amount)\)/);
  assert.match(exportRoute, /Amount: String\(r\.amount\)/);
});

test("statement upload bounds chunked bodies before multipart parsing", () => {
  const route = source(
    "apps/web/app/api/bms/bank-reconciliation/imports/preview/route.ts",
  );
  assert.match(route, /async function readBoundedBody/);
  assert.match(route, /total > maxBytes/);
  assert.match(route, /RequestTooLargeError/);
  assert.doesNotMatch(route, /request\.formData\(\)/);
});

test("matching locks both the statement entry and its import status", () => {
  const service = source("apps/web/lib/bms/bankReconciliation.ts");
  assert.match(service, /FOR UPDATE OF e,i/);
});
