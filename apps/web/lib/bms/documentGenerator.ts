// =============================================================
// BMS Document Generator — MVP core (Excel / CSV / PDF)
// -------------------------------------------------------------
// One shared ReportDoc shape per report type (buildReportDoc()), consumed
// by all three format builders so XLSX/CSV/PDF of the same report can
// never disagree on columns/rows — build the mapping once, not three times.
//
// ⚠️ Known gap, called out on purpose (not a silent bug): `pdfkit`'s
// built-in standard fonts (Helvetica etc.) only cover Latin/WinAnsi
// glyphs — Thai text renders as blank boxes. This module keeps PDF
// labels in English for that reason. Thai data VALUES (product names,
// channel names, etc. as typed by the shop) will still not render
// correctly in the PDF until a Thai-capable TTF (e.g. Noto Sans Thai) is
// embedded via `.font()` — deferred, not attempted here. XLSX and CSV are
// plain UTF-8 text and render Thai correctly today.
// =============================================================

import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";

export type ReportColumn = { key: string; label: string };
export type ReportSheet = { name: string; columns: ReportColumn[]; rows: Record<string, any>[] };
export type ReportDoc = {
  title: string;
  subtitle: string;
  meta: Array<{ label: string; value: string }>;
  sheets: ReportSheet[];
};

// ---- ReportDoc builders (one per report type) ----

export function buildSalesReportDoc(data: {
  summary: Awaited<ReturnType<typeof import("./reports").getSalesSummary>>;
  topProducts: Awaited<ReturnType<typeof import("./reports").getTopSellingProducts>>;
}): ReportDoc {
  const { summary, topProducts } = data;
  return {
    title: "Sales Report",
    subtitle: `${summary.from} – ${summary.to}`,
    meta: [
      { label: "Revenue", value: summary.revenue.toLocaleString() },
      { label: "Refunds recorded in period", value: summary.refundTotal.toLocaleString() },
      { label: "Net revenue", value: summary.netRevenue.toLocaleString() },
      { label: "Orders", value: String(summary.orderCount) },
      { label: "Avg order value", value: summary.avgOrderValue.toFixed(2) },
    ],
    sheets: [
      {
        name: "By day",
        columns: [
          { key: "day", label: "Date" },
          { key: "revenue", label: "Revenue" },
          { key: "orders", label: "Orders" },
        ],
        rows: summary.byDay,
      },
      {
        name: "Top products",
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Product" },
          { key: "qty", label: "Qty sold" },
          { key: "revenue", label: "Revenue" },
        ],
        rows: topProducts,
      },
      {
        name: "By channel",
        columns: [
          { key: "channel", label: "Channel" },
          { key: "revenue", label: "Revenue" },
          { key: "orders", label: "Orders" },
        ],
        rows: summary.byChannel,
      },
      {
        name: "By status",
        columns: [
          { key: "status", label: "Status" },
          { key: "count", label: "Order count" },
        ],
        rows: summary.byStatus,
      },
    ],
  };
}

export function buildInventoryReportDoc(data: {
  summary: Awaited<ReturnType<typeof import("./reports").getInventorySummary>>;
  lowStock: Awaited<ReturnType<typeof import("./products").listLowStock>>;
}): ReportDoc {
  const { summary, lowStock } = data;
  return {
    title: "Inventory Report",
    subtitle: "Current stock snapshot",
    meta: [
      { label: "Active SKUs", value: String(summary.skuCount) },
      { label: "Total units", value: String(summary.totalUnits) },
      { label: "Available units", value: String(summary.availableUnits) },
      { label: "Retail value", value: summary.stockRetailValue.toLocaleString() },
      {
        label: "Cost value",
        value: summary.stockCostValue === null
          ? `Unavailable — ${summary.missingCostVariantCount} stocked variant(s) missing cost`
          : summary.stockCostValue.toLocaleString(),
      },
      { label: "Known cost value", value: summary.knownStockCostValue.toLocaleString() },
      { label: "Low stock", value: String(summary.lowStockCount) },
      { label: "Out of stock", value: String(summary.outOfStockCount) },
    ],
    sheets: [
      {
        name: "Low / out of stock",
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Product" },
          { key: "size", label: "Size" },
          { key: "current_stock", label: "Current stock" },
          { key: "reserved_stock", label: "Reserved" },
          { key: "available", label: "Available" },
          { key: "reorder_point", label: "Reorder point" },
        ],
        rows: lowStock,
      },
    ],
  };
}

export function buildProfitReportDoc(data: {
  summary: Awaited<ReturnType<typeof import("./reports").getProfitSummary>>;
}): ReportDoc {
  const { summary } = data;
  return {
    title: "Gross Profit Report",
    subtitle: `${summary.from} – ${summary.to} — ${summary.disclaimer}`,
    meta: [
      { label: "Revenue", value: summary.revenue.toLocaleString() },
      {
        label: "Cost (sale-time snapshot)",
        value: summary.cost === null
          ? `Unavailable — ${summary.missingCostSkuCount} SKU(s) missing cost`
          : summary.cost.toLocaleString(),
      },
      { label: "Known cost only", value: summary.knownCost.toLocaleString() },
      { label: "Gross profit", value: summary.profit === null ? "Unavailable" : summary.profit.toLocaleString() },
      { label: "Margin", value: summary.marginPct === null ? "Unavailable" : `${summary.marginPct.toFixed(1)}%` },
      { label: "Cost completeness", value: summary.complete ? "Complete" : "Incomplete" },
      { label: "Sale-time evidence", value: summary.authoritative ? "Authoritative snapshots" : `Mixed / reconstructed (${summary.legacyCostLineCount} legacy lines)` },
    ],
    sheets: [
      {
        name: "By day",
        columns: [
          { key: "day", label: "Date" },
          { key: "revenue", label: "Revenue" },
          { key: "cost", label: "Cost" },
          { key: "profit", label: "Profit" },
          { key: "missingCostLineCount", label: "Lines missing cost" },
        ],
        rows: summary.byDay,
      },
    ],
  };
}

type ManagementReport = Awaited<ReturnType<typeof import("./reports").getManagementReport>>;

function summarySheet(rows: Array<{ metric: string; value: string | number }>): ReportSheet {
  return {
    name: "Summary",
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows,
  };
}

export function buildProductsReportDoc(data: ManagementReport): ReportDoc {
  return {
    title: "Product Performance Report",
    subtitle: `${data.from} – ${data.to}`,
    meta: [
      { label: "Active SKUs", value: String(data.products.activeSkuCount) },
      { label: "SKUs sold", value: String(data.products.soldSkuCount) },
      { label: "SKUs with no sales", value: String(data.products.unsoldSkuCount) },
      { label: "Sold SKUs missing cost", value: String(data.products.missingCostSkuCount) },
      { label: "Product revenue basis", value: "Sale-time item price before order-level discounts; use the Profit report for order-net gross profit" },
    ],
    sheets: [
      {
        name: "Top products",
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Product" },
          { key: "category", label: "Category" },
          { key: "qty", label: "Qty sold" },
          { key: "revenue", label: "Revenue" },
          { key: "profit", label: "Contribution before order discounts" },
          { key: "marginPct", label: "Pre-discount contribution %" },
          { key: "missingCost", label: "Missing cost" },
        ],
        rows: data.products.top,
      },
      {
        name: "Slow products",
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Product" },
          { key: "category", label: "Category" },
          { key: "qty", label: "Qty sold" },
          { key: "revenue", label: "Revenue" },
        ],
        rows: data.products.slow,
      },
    ],
  };
}

export function buildPaymentsReportDoc(data: ManagementReport): ReportDoc {
  return {
    title: "Payments and Reconciliation Report",
    subtitle: `${data.from} – ${data.to}`,
    meta: [
      { label: "Payments received", value: data.payments.receivedAmount.toLocaleString() },
      { label: "Refunds completed", value: data.payments.refundedAmount.toLocaleString() },
      { label: "Pending amount", value: data.payments.pendingAmount.toLocaleString() },
      { label: "Pending records", value: String(data.payments.pendingCount) },
    ],
    sheets: [
      {
        name: "By method",
        columns: [
          { key: "key", label: "Payment method" },
          { key: "count", label: "Count" },
          { key: "amount", label: "Amount" },
        ],
        rows: data.payments.byMethod,
      },
      {
        name: "By status",
        columns: [
          { key: "key", label: "Status" },
          { key: "count", label: "Count" },
          { key: "amount", label: "Amount" },
        ],
        rows: data.payments.byStatus,
      },
      { ...summarySheet([
        { metric: "Paid-order amount", value: data.reconciliation.paidOrderAmount },
        { metric: "Payments received", value: data.reconciliation.paymentReceivedAmount },
        { metric: "Completed refunds", value: data.reconciliation.completedRefundAmount },
        { metric: "Net payments", value: data.reconciliation.netPaymentAmount },
        { metric: "Net order amount", value: data.reconciliation.netOrderAmount },
        { metric: "Net payment vs net sales", value: data.reconciliation.paymentDifference },
        { metric: "Issued tax-document amount", value: data.reconciliation.taxDocumentAmount },
        { metric: "Expected cash", value: data.reconciliation.expectedCash },
        { metric: "Counted cash", value: data.reconciliation.countedCash },
        { metric: "Cash difference", value: data.reconciliation.cashDifference },
        { metric: "Reconciliation signals", value: data.reconciliation.mismatchCount },
      ]), name: "Reconciliation" },
    ],
  };
}

export function buildPurchasesReportDoc(data: ManagementReport): ReportDoc {
  return {
    title: "Purchasing and Supplier Report",
    subtitle: `${data.from} – ${data.to} — shop-wide because purchase orders are not branch-owned`,
    meta: [
      { label: "Purchase orders", value: String(data.purchases.poCount) },
      { label: "Ordered amount", value: data.purchases.orderedAmount.toLocaleString() },
      { label: "Open purchase orders", value: String(data.purchases.openCount) },
      { label: "Open amount", value: data.purchases.openAmount.toLocaleString() },
    ],
    sheets: [
      {
        name: "By status",
        columns: [
          { key: "key", label: "Status" },
          { key: "count", label: "PO count" },
          { key: "amount", label: "Ordered amount" },
        ],
        rows: data.purchases.byStatus,
      },
      {
        name: "By supplier",
        columns: [
          { key: "key", label: "Supplier" },
          { key: "count", label: "PO count" },
          { key: "amount", label: "Ordered amount" },
        ],
        rows: data.purchases.bySupplier,
      },
      {
        name: "Supplier performance",
        columns: [
          { key: "supplier", label: "Supplier" },
          { key: "poCount", label: "PO count" },
          { key: "orderedQty", label: "Ordered qty" },
          { key: "receivedQty", label: "Received qty" },
          { key: "fillRate", label: "Fill rate %" },
          { key: "avgLeadDays", label: "Approx. lead days" },
          { key: "openPoCount", label: "Open POs" },
        ],
        rows: data.supplierPerformance,
      },
    ],
  };
}

export function buildCustomersReportDoc(data: ManagementReport): ReportDoc {
  const c = data.customers;
  return {
    title: "Customer Report",
    subtitle: `${data.from} – ${data.to} — customer totals are shop-wide; purchase behavior follows branch scope`,
    meta: [
      { label: "Customers", value: String(c.totalCustomers) },
      { label: "New customers", value: String(c.newCustomers) },
      { label: "Purchasing customers", value: String(c.purchasingCustomers) },
      { label: "Repeat customers", value: String(c.repeatCustomers) },
      { label: "Repeat rate", value: `${c.repeatRate.toFixed(1)}%` },
    ],
    sheets: [summarySheet([
      { metric: "Total customers", value: c.totalCustomers },
      { metric: "New customers", value: c.newCustomers },
      { metric: "Purchasing customers", value: c.purchasingCustomers },
      { metric: "Repeat customers", value: c.repeatCustomers },
      { metric: "Repeat rate %", value: c.repeatRate },
      { metric: "Anonymous orders", value: c.anonymousOrders },
      { metric: "Identified-customer revenue", value: c.identifiedRevenue },
      { metric: "Average revenue per purchasing customer", value: c.avgRevenuePerCustomer },
    ]), {
      name: "Customer segments",
      columns: [
        { key: "key", label: "Segment" },
        { key: "count", label: "Customers" },
        { key: "amount", label: "Lifetime paid-order value" },
      ],
      rows: data.customerSegments,
    }],
  };
}

export function buildOperationsReportDoc(data: ManagementReport): ReportDoc {
  const x = data.controls;
  const f = data.fulfillment;
  const l = data.liabilities;
  return {
    title: "Operations and Control Report",
    subtitle: `${data.from} – ${data.to} — accounting balances are shop-wide; operational events follow branch scope`,
    meta: [
      { label: "Discounts", value: x.discountAmount.toLocaleString() },
      { label: "Void amount", value: x.voidAmount.toLocaleString() },
      { label: "Absolute cash variance", value: x.absoluteCashVariance.toLocaleString() },
      { label: "Balance mismatches", value: String(l.balanceMismatchCount) },
    ],
    sheets: [
      summarySheet([
        { metric: "Discount amount", value: x.discountAmount },
        { metric: "Void count", value: x.voidCount },
        { metric: "Void amount", value: x.voidAmount },
        { metric: "No-sale drawer opens", value: x.noSaleCount },
        { metric: "Cash in", value: x.cashIn },
        { metric: "Cash out", value: x.cashOut },
        { metric: "Absolute cash variance", value: x.absoluteCashVariance },
        { metric: "Closed shifts", value: x.closedShiftCount },
        { metric: "Wastage qty", value: x.wastageQty },
        { metric: "Shipments", value: f.shipmentCount },
        { metric: "Delivered", value: f.deliveredCount },
        { metric: "Shipment exceptions", value: f.exceptionCount },
        { metric: "Loyalty liability", value: l.loyaltyValue },
        { metric: "Store-credit liability", value: l.storeCreditAmount },
        { metric: "Accounts receivable", value: l.arOutstandingAmount },
        { metric: "Overdue receivable", value: l.arOverdueAmount },
        { metric: "Ledger balance mismatches", value: l.balanceMismatchCount },
      ]),
      {
        name: "Branches",
        columns: [
          { key: "code", label: "Branch code" },
          { key: "name", label: "Branch" },
          { key: "orders", label: "Orders" },
          { key: "revenue", label: "Revenue" },
        ],
        rows: data.branches,
      },
      {
        name: "Fulfillment status",
        columns: [
          { key: "key", label: "Status" },
          { key: "count", label: "Count" },
        ],
        rows: f.byStatus,
      },
      {
        name: "Stock movements",
        columns: [
          { key: "key", label: "Movement" },
          { key: "count", label: "Qty" },
        ],
        rows: x.stockMovements,
      },
      { ...summarySheet([
        { metric: "Previous period", value: `${data.comparison.previousFrom} – ${data.comparison.previousTo}` },
        { metric: "Net-revenue change %", value: data.comparison.revenueChangePct ?? "Unavailable (zero baseline)" },
        { metric: "Paid-order change %", value: data.comparison.orderChangePct ?? "Unavailable (zero baseline)" },
        { metric: "Gross-profit change %", value: data.comparison.profitChangePct ?? "Unavailable / incomplete cost" },
      ]), name: "Period comparison" },
      { ...summarySheet([
        { metric: "Stocked variants", value: data.inventoryAging.stockedVariantCount },
        { metric: "Dormant units (>90 days)", value: data.inventoryAging.deadStockUnits },
        { metric: "Dormant known cost", value: data.inventoryAging.deadStockValue },
        { metric: "Estimated days of cover", value: data.inventoryAging.estimatedDaysCover ?? "Unavailable" },
        { metric: "31–60 day variants", value: data.inventoryAging.age31To60Count },
        { metric: "61–90 day variants", value: data.inventoryAging.age61To90Count },
        { metric: "91–180 day variants", value: data.inventoryAging.age91To180Count },
        { metric: "180+ day variants", value: data.inventoryAging.age180PlusCount },
        { metric: "Method", value: data.inventoryAging.method },
      ]), name: "Inventory aging" },
      { ...summarySheet([
        { metric: "Discounted orders", value: data.discountPerformance.discountedOrderCount },
        { metric: "Discount amount", value: data.discountPerformance.discountAmount },
        { metric: "Discount rate %", value: data.discountPerformance.discountRate },
        { metric: "Sale-time promotion lines", value: data.discountPerformance.promotionLineCount },
      ]), name: "Discount signals" },
    ],
  };
}

export function buildSpecializedReportDoc(data: ManagementReport): ReportDoc {
  const specialist = data.archetype;
  const catalog = specialist.catalog;
  const modules = new Set(specialist.profile.moduleKeys);
  const catalogRows: Array<{ metric: string; value: string | number }> = [
    { metric: "Archetype", value: specialist.profile.archetype ?? "not configured" },
    { metric: "Report group", value: specialist.profile.group },
    { metric: "Enabled report modules", value: specialist.profile.moduleKeys.join(", ") },
  ];
  if (modules.has("VARIANTS") || modules.has("RESTAURANT")) catalogRows.push(
    { metric: "Active variants", value: catalog.activeVariantCount },
    { metric: "Products with multiple variants", value: catalog.multiVariantProductCount }
  );
  if (modules.has("PACKS")) catalogRows.push(
    { metric: "Active selling units", value: catalog.activePackCount },
    { metric: "Alternate packs", value: catalog.alternatePackCount }
  );
  if (modules.has("LOTS_EXPIRY")) catalogRows.push(
    { metric: "Stocked lots", value: catalog.stockedLotCount },
    { metric: "Lots expiring in 30 days", value: catalog.expiringLotCount },
    { metric: "Expired stocked lots", value: catalog.expiredLotCount },
    { metric: "Lots missing expiry", value: catalog.lotsMissingExpiry }
  );
  if (modules.has("SERIALS")) catalogRows.push(
    { metric: "Serial-tracked SKUs", value: catalog.serialTrackedSkuCount },
    { metric: "Serials in stock", value: catalog.serialInStockCount },
    { metric: "Serials returned", value: catalog.serialReturnedCount }
  );
  if (modules.has("WASTAGE")) catalogRows.push(
    { metric: "Wastage units", value: data.controls.wastageQty }
  );
  if (modules.has("ACCOUNTS_RECEIVABLE")) catalogRows.push(
    { metric: "Accounts receivable", value: data.liabilities.arOutstandingAmount },
    { metric: "Overdue receivable", value: data.liabilities.arOverdueAmount }
  );
  const sheets: ReportSheet[] = [summarySheet(catalogRows)];

  if (specialist.restaurant) {
    const x = specialist.restaurant;
    sheets.push({ ...summarySheet([
      { metric: "Checks opened", value: x.checkCount },
      { metric: "Paid checks", value: x.paidCheckCount },
      { metric: "Cancelled checks", value: x.cancelledCheckCount },
      { metric: "Guests", value: x.guestCount },
      { metric: "Average table minutes", value: x.avgTableMinutes },
      { metric: "Kitchen tickets", value: x.kitchenTicketCount },
      { metric: "Tickets served", value: x.servedTicketCount },
      { metric: "Average kitchen minutes", value: x.avgKitchenMinutes },
      { metric: "QR submissions", value: x.qrSubmissionCount },
      { metric: "QR submissions accepted", value: x.qrAcceptedCount },
    ]), name: "Restaurant operations" });
  }
  if (specialist.pharmacy) {
    const x = specialist.pharmacy;
    sheets.push({ ...summarySheet([
      { metric: "Product policies", value: x.policyCount },
      { metric: "Approved policies", value: x.approvedPolicyCount },
      { metric: "Draft policies", value: x.draftPolicyCount },
      { metric: "Policies pending review", value: x.pendingReviewPolicyCount },
      { metric: "Retired policies", value: x.retiredPolicyCount },
      { metric: "Active SKUs missing policy", value: x.missingPolicySkuCount },
      { metric: "Expired stocked lots", value: catalog.expiredLotCount },
      { metric: "Lots expiring in 30 days", value: catalog.expiringLotCount },
      { metric: "Stocked lots missing expiry", value: catalog.lotsMissingExpiry },
    ]), name: "Pharmacy compliance" });
  }
  if (specialist.boardGame) {
    const x = specialist.boardGame;
    sheets.push({ ...summarySheet([
      { metric: "Play sessions", value: x.sessionCount },
      { metric: "Paid sessions", value: x.paidSessionCount },
      { metric: "Cancelled sessions", value: x.cancelledSessionCount },
      { metric: "Players / guests", value: x.guestCount },
      { metric: "Average play minutes", value: x.avgPlayMinutes },
      { metric: "Paid billing groups", value: x.paidBillingGroupCount },
      { metric: "Open billing groups", value: x.openBillingGroupCount },
      { metric: "Settled session amount", value: x.settledAmount },
      { metric: "Game titles", value: x.titleCount },
      { metric: "Game copies", value: x.copyCount },
      { metric: "Available copies", value: x.availableCopyCount },
      { metric: "Copies needing attention", value: x.attentionCopyCount },
      { metric: "Active member passes", value: x.activePassCount },
      { metric: "Unused pass minutes", value: x.remainingPassMinutes },
    ]), name: "Board-game operations" });
  }

  return {
    title: "Store Archetype Specialist Report",
    subtitle: `${data.from} – ${data.to} — ${specialist.profile.archetype ?? "archetype not configured"}`,
    meta: [
      { label: "Report group", value: specialist.profile.group },
      { label: "Included modules", value: specialist.profile.moduleKeys.join(", ") },
      { label: "Privacy boundary", value: "Aggregated operational facts only; no pharmacy patient or clinical-case data" },
    ],
    sheets,
  };
}

// ---- format builders ----

/**
 * Excel sheet names forbid : \ / ? * [ ] and are capped at 31 chars — replace the forbidden
 * characters instead of just truncating, or `book_append_sheet` throws (hit this for real with
 * doc.sheets[].name === "Low / out of stock" — every INVENTORY/XLSX export failed 100% of the time).
 */
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Sheet1";
}

export function buildXlsx(doc: ReportDoc): Buffer {
  const wb = XLSX.utils.book_new();

  const summaryAoa: any[][] = [[doc.title], [doc.subtitle], [], ...doc.meta.map((m) => [m.label, m.value])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), "Summary");

  for (const sheet of doc.sheets) {
    if (sheet.rows.length === 0) continue;
    const header = sheet.columns.map((c) => c.label);
    const body = sheet.rows.map((row) => sheet.columns.map((c) => row[c.key] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    // best-effort auto width — spec asks for it, this is the cheap version
    ws["!cols"] = sheet.columns.map((c) => ({ wch: Math.max(c.label.length + 2, 12) }));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name));
  }

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return out as Buffer;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV has no multi-sheet concept, so every sheet is written into the same file
 * one after another, each preceded by a "# <sheet name>" marker line and
 * separated by a blank line — this used to only emit `doc.sheets[0]`, silently
 * dropping every other sheet (e.g. "Top products"/"By channel"/"By status" on
 * the Sales report) from CSV exports while XLSX/PDF were unaffected.
 */
export function buildCsv(doc: ReportDoc): Buffer {
  const lines: string[] = [];
  for (const sheet of doc.sheets) {
    if (sheet.rows.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`# ${sheet.name}`);
    lines.push(sheet.columns.map((c) => csvEscape(c.label)).join(","));
    for (const row of sheet.rows) {
      lines.push(sheet.columns.map((c) => csvEscape(row[c.key])).join(","));
    }
  }
  // UTF-8 BOM กัน Excel เปิดภาษาไทยเพี้ยน
  return Buffer.from("﻿" + lines.join("\n"), "utf8");
}

export function buildPdf(doc: ReportDoc, summary?: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    pdf.fontSize(18).text(doc.title);
    pdf.fontSize(10).fillColor("#555").text(doc.subtitle);
    pdf.moveDown();

    pdf.fillColor("#000").fontSize(11);
    for (const m of doc.meta) pdf.text(`${m.label}: ${m.value}`);
    pdf.moveDown();

    if (summary) {
      pdf.fontSize(12).text("Summary", { underline: true });
      pdf.fontSize(10).text(summary);
      pdf.moveDown();
    }

    for (const sheet of doc.sheets) {
      if (sheet.rows.length === 0) continue;
      pdf.fontSize(13).text(sheet.name, { underline: true });
      pdf.fontSize(9);
      pdf.text(sheet.columns.map((c) => c.label).join("  |  "));
      for (const row of sheet.rows.slice(0, 200)) {
        // 200-row cap keeps the PDF from growing unbounded for large ranges
        pdf.text(sheet.columns.map((c) => String(row[c.key] ?? "")).join("  |  "));
      }
      pdf.moveDown();
    }

    pdf.end();
  });
}
