import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("management report stays tenant-scoped and supports a branch filter", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  assert.match(reports, /export async function getManagementReport/);
  assert.match(reports, /WHERE l\.tenant_id = \$1 AND l\.active/);
  assert.match(reports, /WHERE p\.tenant_id=\$1 AND p\.active/);
  assert.match(reports, /WHERE p\.tenant_id=\$1 AND p\.status IN \('CONFIRMED','REFUNDED'\)/);
  assert.match(reports, /WHERE po\.tenant_id=\$1/);
  assert.match(reports, /WHERE s\.tenant_id=\$1 AND \(\$4::uuid IS NULL OR o\.location_id=\$4::uuid\)/);
  assert.match(reports, /WHERE m\.tenant_id=\$1 AND \(\$4::uuid IS NULL OR m\.location_id=\$4::uuid\)/);
});

test("all report-center reads keep the report.view permission boundary", () => {
  const resolvers = read("apps/web/graphql/bmsReports.ts");
  assert.match(resolvers, /async bmsManagementReport/);
  const resolverBody = resolvers.slice(resolvers.indexOf("async bmsManagementReport"));
  assert.match(resolverBody, /requirePermission\(ctx, "report\.view"\)/);
  assert.match(resolverBody, /getTenantId\(ctx\)/);
});

test("document generation covers every report-center domain through the shared engine", () => {
  const engine = read("apps/web/lib/bms/reportEngine.ts");
  const generator = read("apps/web/lib/bms/documentGenerator.ts");
  const migration = read("db/migrations/9.95__bms_generated_report_types.sql");
  for (const reportType of [
    "SALES", "INVENTORY", "PROFIT", "PRODUCTS", "PAYMENTS", "PURCHASES", "CUSTOMERS", "OPERATIONS", "SPECIALIZED",
  ]) {
    assert.match(engine, new RegExp(`"${reportType}"`));
    assert.match(migration, new RegExp(`'${reportType}'`));
  }
  for (const builder of [
    "buildProductsReportDoc",
    "buildPaymentsReportDoc",
    "buildPurchasesReportDoc",
    "buildCustomersReportDoc",
    "buildOperationsReportDoc",
  ]) {
    assert.match(generator, new RegExp(`export function ${builder}`));
    assert.match(engine, new RegExp(builder));
  }
});

test("specialist reports are selected by the server-derived shop archetype", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const page = read("apps/web/app/(admin)/admin/reports/page.tsx");
  assert.match(reports, /SELECT business_archetype FROM bms_store_profile WHERE tenant_id=\$1/);
  assert.match(reports, /if \(archetype === "restaurant"\)/);
  assert.match(reports, /if \(archetype === "pharmacy"\)/);
  assert.match(reports, /if \(archetype === "board_game_cafe"\)/);
  assert.match(reports, /WHERE tenant_id=\$1 AND \(\$4::uuid IS NULL OR location_id=\$4::uuid\)/);
  assert.match(page, /archetypeReport\?\.restaurant/);
  assert.match(page, /archetypeReport\?\.pharmacy/);
  assert.match(page, /archetypeReport\?\.boardGame/);
});

test("pharmacy report remains aggregate and excludes clinical case tables", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const specialistStart = reports.indexOf("async function getArchetypeReport");
  const specialistEnd = reports.indexOf("export async function getManagementReport");
  const specialist = reports.slice(specialistStart, specialistEnd);
  assert.doesNotMatch(specialist, /bms_pharmacy_assessments/);
  assert.doesNotMatch(specialist, /bms_pharmacy_clinical_evidence/);
  assert.doesNotMatch(specialist, /medical_info|raw_messages|ai_summary/);
});

test("report page carries the same date and branch scope into reads and generated files", () => {
  const page = read("apps/web/app/(admin)/admin/reports/page.tsx");
  assert.match(page, /bmsManagementReport\(from: \$from, to: \$to, locationId: \$locationId\)/);
  assert.match(page, /input: \{ reportType, format, includeSummary, dateFrom: from, dateTo: to, locationId \}/);
  assert.match(page, /const branchParam = locationId \? `&locationId=/);
  assert.match(page, /pos-returns\?from=.*\$\{branchParam\}/);
  assert.match(page, /pos-return-audit\?from=.*\$\{branchParam\}/);
});

test("inventory valuation separates cost from retail and never fills missing cost with zero", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const page = read("apps/web/app/(admin)/admin/reports/page.tsx");
  assert.match(reports, /stock_retail_value/);
  assert.match(reports, /known_stock_cost_value/);
  assert.match(reports, /stockCostValue: Number\(s\.missing_cost_variant_count\) === 0[\s\S]*: null/);
  assert.match(page, /inventory_cost_incomplete/);
});

test("profit uses immutable sale-time cost evidence and makes legacy reconstruction explicit", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const orders = read("apps/web/lib/bms/orders.ts");
  const migration = read("db/migrations/9.97__bms_sale_cost_report_foundation.sql");
  const profitStart = reports.indexOf("export async function getProfitSummary");
  const profitEnd = reports.indexOf("export async function getPosReturnSummary");
  const profit = reports.slice(profitStart, profitEnd);

  assert.match(orders, /costAmountSnapshot/);
  assert.match(orders, /cost_amount_snapshot, cost_snapshot_source/);
  assert.match(orders, /resolvedConsumption\.flatMap/);
  assert.match(migration, /bms_order_stock_lines/);
  assert.match(migration, /'LEGACY_CURRENT'/);
  assert.match(migration, /'MISSING'/);
  assert.match(profit, /oi\.cost_amount_snapshot/);
  assert.match(profit, /oi\.cost_snapshot_source='LEGACY_CURRENT'/);
  assert.match(profit, /SELECT SUM\(total_amount\) FROM eligible_orders/);
  assert.match(profit, /FINANCIAL_ORDER_STATUSES/);
  assert.match(profit, /bms_pos_refund_allocations/);
  assert.match(profit, /bms_pos_return_items/);
  assert.match(profit, /cost_amount_snapshot \* pri\.qty::numeric \/ NULLIF\(oi\.qty,0\)/);
  assert.match(profit, /o\.status='RETURNED'/);
  assert.match(profit, /NOT EXISTS \(\s*SELECT 1 FROM bms_pos_returns pr/);
  assert.match(profit, /oi\.cost_amount_snapshot AS returned_cost/);
  assert.match(profit, /oi\.id IS NOT NULL AND oi\.cost_amount_snapshot IS NULL/);
  assert.doesNotMatch(profit, /JOIN bms_products/);
});

test("sales totals retain returned receipts before subtracting refund events", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const salesStart = reports.indexOf("export async function getSalesSummary");
  const salesEnd = reports.indexOf("export async function getLifetimeSalesSummary");
  const sales = reports.slice(salesStart, salesEnd);
  assert.match(sales, /FINANCIAL_ORDER_STATUSES/);
  assert.match(sales, /netRevenue: revenue - refundTotal/);
  assert.match(sales, /PARTITION BY order_id ORDER BY occurred_at, event_id/);
  assert.match(sales, /GREATEST\(LEAST\(amount, total_amount - COALESCE\(SUM\(amount\) OVER/);
  assert.match(sales, /pr\.return_location_id AS location_id/);
});

test("management analytics reach GraphQL, the admin screen, and exported documents", () => {
  const reports = read("apps/web/lib/bms/reports.ts");
  const schema = read("apps/web/graphql/typeDefs.ts");
  const page = read("apps/web/app/(admin)/admin/reports/page.tsx");
  const generator = read("apps/web/lib/bms/documentGenerator.ts");
  for (const field of [
    "comparison", "reconciliation", "inventoryAging", "supplierPerformance",
    "discountPerformance", "customerSegments",
  ]) {
    assert.match(reports, new RegExp(`${field}:`));
    assert.match(schema, new RegExp(`${field}:`));
    assert.match(page, new RegExp(field));
    assert.match(generator, new RegExp(field));
  }
  assert.match(reports, /netPaymentAmount - netOrderAmount/);
  assert.match(reports, /FINANCIAL_ORDER_STATUSES = \[\.\.\.PAID, "RETURNED"\]/);
  assert.match(reports, /o\.total_amount \+ COALESCE\(o\.shipping_fee,0\) \+ COALESCE\(o\.rounding_amount,0\)/);
  assert.match(page, /inventory_aging_desc/);
  assert.match(page, /supplier_performance_desc/);
});
