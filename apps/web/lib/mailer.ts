import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";
import { addLog } from "@/lib/log/log.server";
import { recordMailLog, type MailLogCategory } from "@/lib/bms/mailLog";

// ผู้ส่งอีเมล เลือกด้วย env MAIL_PROVIDER — ค่าเดิม (ไม่ตั้ง/ตั้งอื่น) = SendGrid เหมือนเดิมเป๊ะๆ
// ไม่กระทบ caller เดิม (signup verify/password reset/order notify/report digest ใช้ sendEmail() ตัวเดียวกัน)
// ตั้ง MAIL_PROVIDER=gmail + GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD เพื่อส่งผ่าน Gmail SMTP แทน
type MailProvider = "sendgrid" | "gmail";

// แนบไฟล์ — ทั้ง SendGrid (`@sendgrid/mail`) และ nodemailer (Gmail SMTP) รองรับ attachment
// อยู่แล้วในระดับ SDK เพียงแต่ sendEmail() เดิมไม่เคย forward field นี้เข้าไปเลย (ใช้แค่ verify
// signup/order notify/report digest ที่ไม่มีไฟล์แนบ) — เพิ่มเป็น optional เพื่อไม่กระทบ caller เดิม
export type MailAttachment = {
  filename: string;
  /** เนื้อไฟล์ดิบ — SendGrid ต้องการ base64 string (แปลงให้ตอนส่งใน sendViaSendGrid), nodemailer รับ Buffer ตรงๆ */
  content: Buffer;
  mimeType: string;
};

function currentProvider(): MailProvider {
  return process.env.MAIL_PROVIDER === "gmail" ? "gmail" : "sendgrid";
}

// ---------------- SendGrid ----------------

let sendgridInitialized = false;

function initSendGrid() {
  if (sendgridInitialized) return;

  const key = process.env.NEXT_PUBLIC_SENDGRID_API_KEY;
  if (!key) {
    // log ตอน init พัง
    addLog(
      "error",
      "email",
      "SendGrid init failed: missing API key",
      { env: "NEXT_PUBLIC_SENDGRID_API_KEY" }
    );
    throw new Error("Missing SENDGRID_API_KEY");
  }

  sgMail.setApiKey(key);
  sendgridInitialized = true;
}

async function sendViaSendGrid(opts: { to: string; subject: string; html: string; text?: string; attachments?: MailAttachment[] }) {
  const from = process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL;

  if (!from) {
    addLog(
      "error",
      "email",
      "SendGrid send failed: missing FROM email",
      { env: "NEXT_PUBLIC_SENDGRID_FROM_EMAIL" }
    );
    throw new Error("Missing SENDGRID_FROM_EMAIL");
  }

  try {
    initSendGrid();

    const [res] = await sgMail.send({
      to: opts.to,
      from,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        type: a.mimeType,
        content: a.content.toString("base64"),
        disposition: "attachment",
      })),
    });

    const messageId = res?.headers?.["x-message-id"];

    // log: ส่งสำเร็จ
    await addLog("info", "email", "Email sent successfully", {
      to: opts.to,
      subject: opts.subject,
      statusCode: res?.statusCode,
      headers: res?.headers,
    });

    return { statusCode: res?.statusCode, messageId };
  } catch (err: any) {
    // log: ส่งล้มเหลว
    await addLog("error", "email", "Email send failed", {
      to: opts.to,
      subject: opts.subject,
      error: err?.message || err,
      response: err?.response?.body,
      statusCode: err?.code || err?.response?.statusCode,
    });

    // อย่า swallow error – ให้ resolver จัดการต่อ
    throw err;
  }
}

// ---------------- Gmail SMTP ----------------
// ต้องเป็น Google account ที่เปิด 2-Step Verification แล้วสร้าง "App password" ที่
// myaccount.google.com/apppasswords (รหัสผ่านปกติของ Gmail ใช้ login SMTP ไม่ได้แล้ว)
// ข้อดี: ส่งจาก address ของตัวเองจริง SPF/DKIM ผ่านอัตโนมัติ (ต่างจากยิง gmail.com ผ่าน SendGrid
// ที่ล้ม sender-identity/DMARC เพราะ SendGrid ไม่ได้เป็นเจ้าของ DNS ของ gmail.com)
// ข้อจำกัด: โควตา Gmail ปกติ ~500 อีเมล/วัน (Google Workspace ~2000/วัน) — พอสำหรับรายงานสรุปยอดขาย
// แต่ไม่เหมาะกับอีเมลปริมาณมาก/transactional สเกลใหญ่

let gmailTransporter: nodemailer.Transporter | null = null;

function getGmailTransporter(): nodemailer.Transporter {
  if (gmailTransporter) return gmailTransporter;

  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) {
    addLog("error", "email", "Gmail SMTP init failed: missing credentials", {
      env: "GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD",
    });
    throw new Error("Missing GMAIL_SMTP_USER/GMAIL_SMTP_APP_PASSWORD");
  }

  gmailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return gmailTransporter;
}

async function sendViaGmail(opts: { to: string; subject: string; html: string; text?: string; attachments?: MailAttachment[] }) {
  const user = process.env.GMAIL_SMTP_USER;
  const fromName = process.env.GMAIL_SMTP_FROM_NAME;

  try {
    const transporter = getGmailTransporter();
    const info = await transporter.sendMail({
      from: fromName ? `${fromName} <${user}>` : user,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.mimeType,
      })),
    });

    await addLog("info", "email", "Email sent successfully (gmail smtp)", {
      to: opts.to,
      subject: opts.subject,
      messageId: info?.messageId,
      response: info?.response,
    });

    return { statusCode: 250, messageId: info?.messageId };
  } catch (err: any) {
    await addLog("error", "email", "Email send failed (gmail smtp)", {
      to: opts.to,
      subject: opts.subject,
      error: err?.message || err,
      responseCode: err?.responseCode,
      response: err?.response,
    });

    throw err;
  }
}

// ---------------- entrypoint ----------------

function fromAddressFor(provider: MailProvider): string | null {
  if (provider === "gmail") return process.env.GMAIL_SMTP_USER ?? null;
  return process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL ?? null;
}

// รูปแบบ error message ของทั้งสอง provider ซ้ำกับที่ resolver บางจุด (bmsSqlConsole.ts/
// reportDigest.ts) ประกอบเป็นข้อความไทยให้ผู้ใช้อ่านอยู่แล้ว — ตัวนี้แค่เก็บลง mail log
// เป็น debug string ดิบ ไม่ใช่ข้อความ user-facing จึงไม่ต้องรวมเป็นฟังก์ชันเดียวกัน
function extractErrorMessage(err: any): string {
  const providerErrors = err?.response?.body?.errors;
  if (Array.isArray(providerErrors) && providerErrors.length) {
    return providerErrors.map((x: any) => x?.message || JSON.stringify(x)).join("; ");
  }
  if (err?.responseCode && typeof err?.response === "string") {
    return `SMTP ${err.responseCode}: ${err.response}`;
  }
  return err?.message || "ส่งอีเมลไม่สำเร็จ";
}

export async function sendEmail(
  opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    /** ไฟล์แนบ (เช่น รายงาน Excel ที่สร้างไว้แล้ว) — optional, caller เดิมทั้งหมดไม่ส่งค่านี้ */
    attachments?: MailAttachment[];
  },
  meta: { tenantId?: string | null; category?: MailLogCategory; triggeredBy?: string | null } = {}
) {
  const provider = currentProvider();

  // log: ก่อนส่ง (ใช้ร่วมทั้งสอง provider) — ไม่ log เนื้อไฟล์แนบ แค่ชื่อ/จำนวน กัน log บวมและกัน PII/ข้อมูลธุรกิจรั่วเข้า log
  await addLog("info", "email", "Sending email", {
    to: opts.to,
    subject: opts.subject,
    provider,
    attachmentCount: opts.attachments?.length ?? 0,
  });

  const logBase = {
    tenantId: meta.tenantId ?? null,
    category: meta.category ?? ("other" as MailLogCategory),
    triggeredBy: meta.triggeredBy ?? null,
    provider,
    to: opts.to,
    from: fromAddressFor(provider),
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? null,
  };

  try {
    const result = provider === "gmail" ? await sendViaGmail(opts) : await sendViaSendGrid(opts);
    await recordMailLog({
      ...logBase,
      status: "success",
      messageId: result?.messageId ?? null,
      statusCode: result?.statusCode ?? null,
    });
    return result;
  } catch (err: any) {
    await recordMailLog({ ...logBase, status: "error", error: extractErrorMessage(err) });
    throw err;
  }
}
