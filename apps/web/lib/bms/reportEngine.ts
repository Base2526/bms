// =============================================================
// BMS AI Report & Document Generation — MVP core
// -------------------------------------------------------------
// generateReport() is the one place that: validates input, calls the
// existing read-only business APIs (reports.ts/products.ts — never touches
// the DB directly itself), optionally drafts an AI executive summary,
// builds the file via documentGenerator.ts, persists it through the same
// files/STORAGE_DIR mechanism as uploads, and logs an audit row. Both the
// AI tool (tools/catalog.ts's generate_report) and the GraphQL mutation
// (bmsGenerateReport) call this one function — REST/tool-calling/GraphQL
// can never drift apart on what a "generated report" means.
// =============================================================

import { query } from "@/lib/db";
import { audit } from "./audit";
import { persistBuffer } from "@/lib/storage";
import { getSalesSummary, getInventorySummary, getTopSellingProducts, getProfitSummary } from "./reports";
import { listLowStock } from "./products";
import { resolveAiCredentials } from "./ai";
import { finalizeAiUsageEvent, recordAiProviderAttempt } from "./aiUsage";
import { callAnthropicCompatibleMessages } from "./aiProvider";
import {
  buildSalesReportDoc,
  buildInventoryReportDoc,
  buildProfitReportDoc,
  buildXlsx,
  buildCsv,
  buildPdf,
  type ReportDoc,
} from "./documentGenerator";

export const REPORT_TYPES = ["SALES", "INVENTORY", "PROFIT"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ["XLSX", "CSV", "PDF"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type GenerateReportInput = {
  reportType: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  format: string;
  includeSummary?: boolean;
};

export type GenerateReportResult = {
  fileId: number;
  fileUrl: string;
  reportType: ReportType;
  format: ReportFormat;
  summary: string | null;
};

function assertReportType(v: string): ReportType {
  if (!(REPORT_TYPES as readonly string[]).includes(v)) {
    throw new Error(`reportType ต้องเป็นหนึ่งใน: ${REPORT_TYPES.join(", ")}`);
  }
  return v as ReportType;
}

function assertFormat(v: string): ReportFormat {
  if (!(REPORT_FORMATS as readonly string[]).includes(v)) {
    throw new Error(`format ต้องเป็นหนึ่งใน: ${REPORT_FORMATS.join(", ")}`);
  }
  return v as ReportFormat;
}

async function collectReportDoc(tenantId: string, reportType: ReportType, dateFrom: string | null, dateTo: string | null): Promise<ReportDoc> {
  switch (reportType) {
    case "SALES": {
      const [summary, topProducts] = await Promise.all([
        getSalesSummary(tenantId, dateFrom, dateTo),
        getTopSellingProducts(tenantId, dateFrom, dateTo, 20),
      ]);
      return buildSalesReportDoc({ summary, topProducts });
    }
    case "INVENTORY": {
      const [summary, lowStock] = await Promise.all([getInventorySummary(tenantId), listLowStock(tenantId)]);
      return buildInventoryReportDoc({ summary, lowStock });
    }
    case "PROFIT": {
      const summary = await getProfitSummary(tenantId, dateFrom, dateTo);
      return buildProfitReportDoc({ summary });
    }
  }
}

/**
 * สรุป executive summary สั้นๆ จากตัวเลขที่ collect มาแล้วเท่านั้น (ห้ามให้ AI เดาตัวเลขเอง)
 * ไม่มี AI credentials/quota → คืน null (ไม่ fabricate ประโยคสรุปทั่วไปแทน ต่างจาก Follow-up module
 * ที่มี fallback template ได้ เพราะ "สรุปตัวเลข" ไม่มี template ที่ปลอดภัยจะเดาแทน)
 */
async function draftSummary(tenantId: string, doc: ReportDoc): Promise<string | null> {
  const creds = await resolveAiCredentials(tenantId, { surface: "system", feature: "report_summary" });
  if (!creds) return null;
  try {
    if (creds.usageEventId) await recordAiProviderAttempt(creds.usageEventId);
    const factsText = [doc.title, doc.subtitle, ...doc.meta.map((m) => `${m.label}: ${m.value}`)].join("\n");
    const resp = await callAnthropicCompatibleMessages(creds, {
      model: creds.model,
      max_tokens: 180,
      system:
        "Write a 2-4 sentence executive summary of this business report using ONLY the facts given. " +
        "Never invent a number that isn't in the facts. Reply with only the summary text.",
      messages: [{ role: "user", content: factsText }],
    });
    if (!resp.ok) throw new Error(`${creds.provider} API ${resp.status}`);
    const json = (await resp.json()) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = json.content?.[0]?.text?.trim() || null;
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: text ? "completed" : "failed",
        inputTokens: json.usage?.input_tokens ?? null,
        outputTokens: json.usage?.output_tokens ?? null,
      });
    }
    return text;
  } catch (err) {
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "report summary generation failed",
      });
    }
    console.error("[BMS] report summary generation failed:", err);
    return null;
  }
}

const FORMAT_MIME: Record<ReportFormat, string> = {
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  CSV: "text/csv; charset=utf-8",
  PDF: "application/pdf",
};
const FORMAT_EXT: Record<ReportFormat, string> = { XLSX: "xlsx", CSV: "csv", PDF: "pdf" };

export async function generateReport(
  tenantId: string,
  ctx: any,
  input: GenerateReportInput
): Promise<GenerateReportResult> {
  const reportType = assertReportType(input.reportType);
  const format = assertFormat(input.format);
  const dateFrom = input.dateFrom || null;
  const dateTo = input.dateTo || null;
  const includeSummary = input.includeSummary ?? true;

  const doc = await collectReportDoc(tenantId, reportType, dateFrom, dateTo);
  const summary = includeSummary ? await draftSummary(tenantId, doc) : null;

  let buf: Buffer;
  if (format === "XLSX") buf = buildXlsx(doc);
  else if (format === "CSV") buf = buildCsv(doc);
  else buf = await buildPdf(doc, summary);

  const filename = `${reportType.toLowerCase()}-report-${Date.now()}.${FORMAT_EXT[format]}`;
  // รายงานเป็นของร้านที่สั่งสร้าง — ผูก tenant ไว้เพื่อให้ /api/files ปฏิเสธร้านอื่น (9.27)
  const file = await persistBuffer(buf, filename, FORMAT_MIME[format], "private", tenantId);

  await query(
    `INSERT INTO bms_generated_reports (tenant_id, report_type, format, params, file_id, summary, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      tenantId,
      reportType,
      format,
      JSON.stringify({ dateFrom, dateTo, includeSummary }),
      file.id,
      summary,
      ctx?.admin?.email || ctx?.admin?.id || "system",
    ]
  );
  await audit(ctx, "report.generate", String(file.id), { reportType, format, dateFrom, dateTo });

  return {
    fileId: file.id,
    fileUrl: `/api/bms/reports/download/${file.id}`,
    reportType,
    format,
    summary,
  };
}

export async function listGeneratedReports(tenantId: string, limit = 50) {
  const res = await query(
    `SELECT id, report_type, format, params, file_id, summary, generated_by, created_at
       FROM bms_generated_reports WHERE tenant_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 200)]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    reportType: r.report_type,
    format: r.format,
    params: r.params,
    fileId: r.file_id,
    fileUrl: r.file_id != null ? `/api/bms/reports/download/${r.file_id}` : null,
    summary: r.summary,
    generatedBy: r.generated_by,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** ใช้โดย download route เพื่อยืนยันว่า fileId นี้เป็นของ tenant นี้จริง ก่อนจะเสิร์ฟไฟล์ */
export async function findGeneratedReportByFileId(tenantId: string, fileId: number) {
  const res = await query(
    `SELECT id, tenant_id, file_id FROM bms_generated_reports WHERE tenant_id = $1 AND file_id = $2 LIMIT 1`,
    [tenantId, fileId]
  );
  return res.rows[0] ?? null;
}
