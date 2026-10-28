import PDFDocument from "pdfkit";
import path from "node:path";
import type { PublicPlan, PresalesLocale } from "./platformPresales";

type PackagePdfPlan = Omit<PublicPlan, "verifiedAt">;

const BLUE = "#1458d4";
const INK = "#172033";
const MUTED = "#667085";
const BORDER = "#d9e2f0";
const SURFACE = "#f5f8fd";
const RECOMMENDED = "#edf4ff";

function copyFor(locale: PresalesLocale) {
  return locale === "th" ? {
    title: "แพ็กเกจ BMS ล่าสุด",
    subtitle: "ราคาและขีดจำกัดสาธารณะสำหรับการสมัครใหม่",
    generated: "สร้างจากข้อมูลแพ็กเกจล่าสุด",
    item: "รายการ",
    monthly: "ราคา / เดือน",
    annual: "ราคา / ปี",
    ai: "AI points / เดือน",
    products: "สินค้า",
    users: "ผู้ใช้",
    branches: "สาขา",
    devices: "เครื่อง POS",
    channels: "ช่องทาง",
    reports: "ตั้งเวลารายงาน",
    retention: "Retention Engine",
    free: "ฟรี",
    from: "เริ่ม",
    unlimited: "ไม่จำกัด",
    included: "รวม",
    excluded: "-",
    note: "Enterprise Factory ต้องประเมิน workload และทำสัญญาขั้นต่ำ 12 เดือน ค่าวางระบบ งานเชื่อมต่อเฉพาะ Premium SLA ค่าผู้ให้บริการภายนอก และการใช้เกินโควตาคิดแยกตามใบเสนอราคา",
    freshness: "ราคาอาจมีการปรับปรุง โปรดแชร์ลิงก์หน้า Pricing เพื่อให้ผู้รับเห็นข้อมูลล่าสุดเสมอ",
  } : {
    title: "Latest BMS packages",
    subtitle: "Public pricing and limits for new sign-ups",
    generated: "Generated from the latest package catalogue",
    item: "Item",
    monthly: "Price / month",
    annual: "Price / year",
    ai: "AI points / month",
    products: "Products",
    users: "Users",
    branches: "Branches",
    devices: "POS devices",
    channels: "Channels",
    reports: "Scheduled reports",
    retention: "Retention Engine",
    free: "Free",
    from: "From",
    unlimited: "Unlimited",
    included: "Included",
    excluded: "-",
    note: "Enterprise Factory requires a workload assessment and a minimum 12-month contract. Implementation, custom integrations, premium SLA, provider fees, and usage beyond published limits are quoted separately.",
    freshness: "Prices may change. Share the Pricing page link so recipients always see the latest information.",
  };
}

const number = (value: number) => Number(value).toLocaleString("en-US");

export async function renderPublicPackagePdf(
  plans: readonly PackagePdfPlan[],
  locale: PresalesLocale,
  generatedAt = new Date(),
): Promise<Buffer> {
  if (!plans.length) throw new Error("PACKAGE_CATALOGUE_EMPTY");
  const c = copyFor(locale);
  const font = path.join(process.cwd(), "public/fonts/sarabun/Sarabun-Regular.ttf");
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 32,
    font,
    info: { Title: c.title, Author: "BMS", Subject: c.subtitle },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 32;
  const width = doc.page.width - 64;
  doc.fillColor(BLUE).fontSize(22).text(c.title, left, 27, { width });
  doc.fillColor(INK).fontSize(11).text(c.subtitle, left, 58, { width });
  const timestamp = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  }).format(generatedAt);
  doc.fillColor(MUTED).fontSize(8.5).text(`${c.generated}: ${timestamp} (Asia/Bangkok)`, left, 76, { width });

  const tableTop = 101;
  const labelWidth = 154;
  const planWidth = (width - labelWidth) / plans.length;
  const headerHeight = 54;
  const rowHeight = 27;
  const rows: Array<[string, (plan: PackagePdfPlan) => string]> = [
    [c.monthly, plan => plan.price_monthly > 0 ? `${plan.code === "enterprise" ? `${c.from} ` : ""}${number(plan.price_monthly)} ฿` : c.free],
    [c.annual, plan => plan.price_yearly > 0 ? `${plan.code === "enterprise" ? `${c.from} ` : ""}${number(plan.price_yearly)} ฿` : c.free],
    [c.ai, plan => plan.ai_credits_monthly < 0 ? c.unlimited : number(plan.ai_credits_monthly)],
    [c.products, plan => plan.max_products < 0 ? c.unlimited : number(plan.max_products)],
    [c.users, plan => plan.max_users < 0 ? c.unlimited : number(plan.max_users)],
    [c.branches, plan => plan.max_branches < 0 ? c.unlimited : number(plan.max_branches)],
    [c.devices, plan => plan.max_devices < 0 ? c.unlimited : number(plan.max_devices)],
    [c.channels, plan => plan.max_channels < 0 ? c.unlimited : number(plan.max_channels)],
    [c.reports, plan => plan.feature_keys.includes("REPORT_SCHEDULE") ? c.included : c.excluded],
    [c.retention, plan => plan.feature_keys.includes("RETENTION_ENGINE") ? c.included : c.excluded],
  ];
  const tableHeight = headerHeight + rows.length * rowHeight;

  doc.roundedRect(left, tableTop, width, tableHeight, 8).fillAndStroke("#ffffff", BORDER);
  doc.rect(left, tableTop, labelWidth, tableHeight).fill(SURFACE);
  plans.forEach((plan, index) => {
    if (plan.code === "pro") doc.rect(left + labelWidth + index * planWidth, tableTop, planWidth, tableHeight).fill(RECOMMENDED);
  });
  doc.fillColor(MUTED).fontSize(9).text(c.item, left + 10, tableTop + 20, { width: labelWidth - 20 });
  plans.forEach((plan, index) => {
    const x = left + labelWidth + index * planWidth;
    doc.fillColor(plan.code === "pro" ? BLUE : INK).fontSize(12.5).text(plan.name, x + 6, tableTop + 16, {
      width: planWidth - 12, align: "center", height: 34, ellipsis: true,
    });
  });
  doc.moveTo(left, tableTop + headerHeight).lineTo(left + width, tableTop + headerHeight).strokeColor(BORDER).stroke();
  rows.forEach(([label, value], rowIndex) => {
    const y = tableTop + headerHeight + rowIndex * rowHeight;
    doc.fillColor(INK).fontSize(9).text(label, left + 10, y + 8, { width: labelWidth - 20, height: 14, ellipsis: true });
    plans.forEach((plan, index) => {
      const x = left + labelWidth + index * planWidth;
      doc.fillColor(INK).fontSize(8.7).text(value(plan), x + 5, y + 8, { width: planWidth - 10, align: "center", height: 14, ellipsis: true });
    });
    if (rowIndex < rows.length - 1) {
      doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).strokeColor(BORDER).stroke();
    }
  });
  for (let index = 0; index <= plans.length; index++) {
    const x = left + labelWidth + index * planWidth;
    doc.moveTo(x, tableTop).lineTo(x, tableTop + tableHeight).strokeColor(BORDER).stroke();
  }

  const noteTop = tableTop + tableHeight + 16;
  doc.fillColor(INK).fontSize(8.5).text(c.note, left, noteTop, { width, lineGap: 2 });
  doc.fillColor(MUTED).fontSize(8).text(c.freshness, left, noteTop + 32, { width, lineGap: 2 });
  // Keep the footer outside the body margin without letting PDFKit flow it onto a blank page.
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fillColor(MUTED).fontSize(8).text("BMS - AI Business Management System", left, doc.page.height - 37, {
    width, align: "right", lineBreak: false,
  });
  doc.page.margins.bottom = bottomMargin;
  doc.end();
  return complete;
}
