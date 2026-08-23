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
      { label: "Stock value", value: summary.stockValue.toLocaleString() },
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
    title: "Profit Report (estimate)",
    subtitle: `${summary.from} – ${summary.to} — ${summary.disclaimer}`,
    meta: [
      { label: "Revenue", value: summary.revenue.toLocaleString() },
      {
        label: "Cost (current cost price)",
        value: summary.cost === null
          ? `Unavailable — ${summary.missingCostSkuCount} SKU(s) missing cost`
          : summary.cost.toLocaleString(),
      },
      { label: "Known cost only", value: summary.knownCost.toLocaleString() },
      { label: "Gross profit", value: summary.profit === null ? "Unavailable" : summary.profit.toLocaleString() },
      { label: "Margin", value: summary.marginPct === null ? "Unavailable" : `${summary.marginPct.toFixed(1)}%` },
      { label: "Cost completeness", value: summary.complete ? "Complete" : "Incomplete" },
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
