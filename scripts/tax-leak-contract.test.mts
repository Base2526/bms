import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("the line_amount backfill bypasses revision amplification only for its update", () => {
  const migration = read("db/migrations/10.13__bms_tax_leak_guards.sql");
  assert.match(
    migration,
    /set_config\('app\.skip_revision', '1', true\);[\s\S]*?UPDATE bms_order_items[\s\S]*?WHERE line_amount IS NULL;[\s\S]*?set_config\('app\.skip_revision', '', true\);/,
    "the legacy backfill must not create one revision snapshot per order line and must restore the flag immediately",
  );
});

test("promotion-exact line_amount is the tax/refund/commission authority", () => {
  const orders = read("apps/web/lib/bms/orders.ts");
  const tax = read("apps/web/lib/bms/taxDocuments.ts");
  const returns = read("apps/web/lib/bms/pos.ts");
  const commission = read("apps/web/lib/bms/commission.ts");
  assert.match(orders, /promoLineAmountByIndex/);
  assert.match(orders, /const productLineAmount = promoLineAmountByIndex\.get\(itemIndex\)/);
  assert.match(orders, /line_amount[\s\S]*ln\.lineAmount/);
  assert.match(tax, /line_amount AS amount/);
  assert.match(returns, /grossTotal[\s\S]*Number\(item\.line_amount\)/);
  assert.match(commission, /SUM\(oi\.line_amount\)/);
  assert.doesNotMatch(tax, /COALESCE\(pack_unit_price \* pack_qty, unit_price \* qty\) AS amount/);
});

test("full invoices lock and reject unpaid, voided and credit-note-less returned orders", () => {
  const src = read("apps/web/lib/bms/taxDocuments.ts");
  const section = src.slice(src.indexOf("export async function issueFullTaxInvoice"));
  assert.match(section, /status, voided_at[\s\S]*FOR UPDATE/);
  // ออกได้ตั้งแต่รับชำระ (จุดความรับผิด VAT) — ไม่ใช่ PENDING/CANCELLED/RETURNED
  assert.match(src, /FULL_INVOICE_ORDER_STATUSES = \["PAID", "PACKING", "SHIPPED", "COMPLETED"\] as const/);
  assert.match(section, /FULL_INVOICE_ORDER_STATUSES as readonly string\[\]\)\.includes\(ord\.rows\[0\]\.status\)/);
  assert.match(section, /voided_at != null/);
  // คืนบางส่วนได้ ต่อเมื่อทุกการคืนมีใบลดหนี้ที่มีผล — ไม่งั้นใบเต็มสูงกว่ายอดขายจริง
  assert.match(section, /FROM bms_pos_returns r[\s\S]*?NOT EXISTS[\s\S]*?cn\.credit_reason LIKE '%\[' \|\| r\.id::text \|\| '\]%'/);
  assert.match(section, /if \(unbackedReturn\.rowCount\)/);
  assert.match(section, /ORDER_NOT_INVOICEABLE/);
  assert.match(section, /INSERT INTO bms_audit_log[\s\S]*tax\.document\.issue_full/);
  assert.doesNotMatch(read("apps/web/graphql/bmsPos.ts"), /audit\(ctx, "tax\.document\.issue_full"/);
});

test("back-office money paths refuse an active sales tax document", () => {
  const guard = read("apps/web/lib/bms/taxDocumentGuards.ts");
  const orders = read("apps/web/lib/bms/orders.ts");
  const payments = read("apps/web/lib/bms/payments.ts");
  assert.match(guard, /doc_type IN \('ABBREVIATED','FULL'\)/);
  assert.match(guard, /cancelled_at IS NULL/);
  assert.match(guard, /คืนผ่านหน้า POS เพื่อออกใบลดหนี้/);
  // ใบที่ลดหนี้ครบแล้วไม่นับว่ายังใช้งาน — ไม่งั้นยกเลิกออร์เดอร์ที่ออกใบเต็มแล้วคืนเงินไม่ได้
  assert.match(guard, /d\.grand_total - COALESCE\(\([\s\S]*?cn\.references_document_id = d\.id[\s\S]*?> 0\.005/);
  // ยกเลิก/คืนทั้งบิลจากหลังบ้าน: ใบย่อยังปฏิเสธ ใบเต็มได้ใบลดหนี้ในทรานแซกชันเดียวกัน
  assert.ok((orders.match(/await creditOutstandingSalesDocumentInTx\(/g) ?? []).length >= 2);
  assert.doesNotMatch(orders, /assertNoActiveSalesTaxDocumentInTx/);
  assert.match(payments, /to === "REFUNDED"[\s\S]*assertNoActiveSalesTaxDocumentInTx/);
});

test("the readiness surface blocks legacy VAT-exclusive settings and the setter cannot recreate them", () => {
  const tax = read("apps/web/lib/bms/taxDocuments.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const page = read("apps/web/app/(admin)/admin/pos-readiness/page.tsx");
  assert.match(tax, /if \(!input\.priceIncludesVat\)/);
  assert.match(pos, /if \(!vat\.priceIncludesVat\)[\s\S]*blockers\.push/);
  assert.match(page, /value: false[\s\S]*disabled: true/);
  assert.match(page, /vat_exclusive_blocker_description/);
});

test("document counters use the two real partial unique-index arbiters", () => {
  const src = read("apps/web/lib/bms/taxDocuments.ts");
  assert.match(src, /ON CONFLICT \(tenant_id, location_id, doc_type, period_key\) WHERE device_id IS NULL/);
  assert.match(src, /ON CONFLICT \(tenant_id, location_id, device_id, doc_type, period_key\) WHERE device_id IS NOT NULL/);
  assert.doesNotMatch(src, /UPDATE bms_document_counters[\s\S]{0,500}if \(upd\.rowCount\)/);
});

test("the sales-tax exception report also finds cancelled/returned orders with active documents", () => {
  const src = read("apps/web/lib/bms/taxReports.ts");
  assert.match(src, /o\.status IN \('RETURNED','CANCELLED'\)/);
  assert.match(src, /d\.cancelled_at IS NULL/);
  assert.match(src, /ออร์เดอร์ถูกคืน\/ยกเลิก แต่เอกสารภาษียังใช้งานอยู่/);
});
