// =============================================================
// BMS AI Report — email a generated report file to an address (A3)
// -------------------------------------------------------------
// ต่อยอดจาก generateReport() (reportEngine.ts) — ไม่ generate ไฟล์ซ้ำ แค่รับ
// fileId ของรายงานที่สร้างไว้แล้ว (ผ่าน findGeneratedReportByFileId() เพื่อ
// ยืนยันว่าเป็นของ tenant นี้จริง — กันเดา/enumerate fileId ข้ามร้าน) แนบเข้า
// อีเมลแล้วส่งผ่าน sendEmail() เดิม (ตอนนี้รองรับ attachments แล้ว ดู mailer.ts)
//
// เรียกได้จาก 2 ทาง ที่ต้องพบกันจุดเดียวเสมอ (ไม่ทำ logic คู่ขนาน):
//   1. AI tool `email_report` (tools/catalog.ts) — sensitive:true, proposal เท่านั้น
//      ตัวทูล generate ไฟล์เอง (เรียก generateReport() ตรงๆ, ไม่ sensitive) แล้วเสนอ
//      "ส่งไฟล์นี้ไปที่ ... " ให้กด Confirm — ตอนกด Confirm ถึงจะยิงมิวเทชันนี้จริง
//   2. bmsEmailReport mutation (graphql/bmsReportEngine.ts) — ปุ่ม Confirm ยิงตรงนี้
//
// ปลายทางเป็น free text ที่มาจากข้อความแชท/ผู้ใช้พิมพ์เอง — ไม่ผ่านการยืนยันตัวตนใดๆ
// จึงต้องเป็น A3 เสมอ (ดู § AI rules ใน CLAUDE.md: sensitive action ต้อง human confirm + RBAC)
// permission แยกจาก report.view เดิม เพราะ "ส่งออกนอกระบบ" เสี่ยงกว่า "ดู/ดาวน์โหลด" มาก
// =============================================================

import { query } from "@/lib/db";
import { audit } from "./audit";
import { sendEmail } from "@/lib/mailer";
import { readStoredFile } from "@/lib/storage";
import { getStoreProfile } from "./storeProfile";
import { getTenantName } from "./platform";
import { findGeneratedReportByFileId, type ReportType, type ReportFormat } from "./reportEngine";

export type EmailReportInput = {
  fileId: number;
  to: string;
  subject?: string | null;
};

export type EmailReportResult = {
  fileId: number;
  to: string;
  reportType: ReportType;
  format: ReportFormat;
};

const REPORT_LABEL_TH: Record<ReportType, string> = {
  SALES: "ยอดขาย",
  INVENTORY: "สต็อกสินค้า",
  PROFIT: "กำไร (ประมาณการ)",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * เดาว่าปลายทางเป็นอีเมลที่ระบบ "รู้จัก" อยู่แล้วหรือไม่ (ปัจจุบันเทียบกับ contact email ของร้านเท่านั้น
 * — ยังไม่เทียบกับ bms_customers.email เพราะทูลนี้เป็นของ staff ไม่ใช่ customer surface) ใช้แค่เตือน UI
 * ก่อนกดยืนยัน ไม่ได้ block การส่ง — ปลายทางถูกต้องหรือไม่ยังเป็นดุลพินิจของแอดมินที่กด Confirm เอง
 */
export async function isKnownReportRecipient(tenantId: string, to: string): Promise<boolean> {
  const profile = await getStoreProfile(tenantId);
  const known = (profile.contactEmail || "").trim().toLowerCase();
  return known !== "" && known === to.trim().toLowerCase();
}

export async function emailGeneratedReport(
  tenantId: string,
  ctx: any,
  input: EmailReportInput
): Promise<EmailReportResult> {
  const to = String(input.to || "").trim();
  if (!isValidEmail(to)) throw new Error("อีเมลปลายทางไม่ถูกต้อง");

  // ต้องมีแถวใน bms_generated_reports ที่ tenant นี้เป็นเจ้าของ fileId นี้จริง — กัน enumerate
  // fileId ข้าม tenant (pattern เดียวกับ route ดาวน์โหลด)
  const owned = await findGeneratedReportByFileId(tenantId, input.fileId);
  if (!owned) throw new Error("ไม่พบรายงานนี้ หรือไม่ใช่ของร้านนี้");

  const { rows } = await query<{
    report_type: ReportType;
    format: ReportFormat;
    filename: string;
    original_name: string | null;
    mimetype: string | null;
    relpath: string;
    deleted_at: string | null;
  }>(
    `SELECT gr.report_type, gr.format, f.filename, f.original_name, f.mimetype, f.relpath, f.deleted_at
       FROM bms_generated_reports gr JOIN files f ON f.id = gr.file_id
      WHERE gr.tenant_id = $1 AND gr.file_id = $2 LIMIT 1`,
    [tenantId, input.fileId]
  );
  const row = rows[0];
  if (!row || row.deleted_at) throw new Error("ไฟล์รายงานนี้ถูกลบไปแล้ว หรือหาไม่พบ");

  let buf: Buffer;
  try {
    buf = await readStoredFile(row.relpath);
  } catch {
    throw new Error("ไม่พบไฟล์รายงานบนเซิร์ฟเวอร์ (อาจถูกย้าย/ลบไปแล้ว)");
  }

  const tenantName = (await getTenantName(tenantId)) || "ร้านค้า";
  const reportLabel = REPORT_LABEL_TH[row.report_type] ?? row.report_type;
  const downloadName = (row.original_name || row.filename || `report-${input.fileId}`).replace(/[\/\\?%*:|"<>]/g, "_");
  const subject = (input.subject || "").trim() || `รายงาน${reportLabel} (${row.format}) — ${tenantName}`;
  const html = `
    <p>เรียนผู้เกี่ยวข้อง,</p>
    <p>แนบไฟล์รายงาน${escapeHtml(reportLabel)} (${escapeHtml(row.format)}) ที่สร้างจากระบบหลังบ้านของ
       <strong>${escapeHtml(tenantName)}</strong></p>
    <p style="color:#8a90a0;font-size:12px;">อีเมลนี้ถูกส่งโดยผู้ช่วย AI ของร้านตามคำสั่งของพนักงาน หลังได้รับการยืนยันแล้ว</p>
  `;

  await sendEmail(
    {
      to,
      subject,
      html,
      attachments: [{ filename: downloadName, content: buf, mimeType: row.mimetype || "application/octet-stream" }],
    },
    { tenantId, category: "other", triggeredBy: "ai:email_report" }
  );

  await audit(ctx, "report.email", String(input.fileId), { to, reportType: row.report_type, format: row.format });

  return { fileId: input.fileId, to, reportType: row.report_type, format: row.format };
}
