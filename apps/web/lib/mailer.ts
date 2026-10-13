import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";
import { addLog } from "@/lib/log/log.server";
import { recordMailLog, type MailLogCategory } from "@/lib/bms/mailLog";

// ผู้ส่งอีเมล เลือกด้วย env MAIL_PROVIDER — ค่าเดิม (ไม่ตั้ง/ตั้งอื่น) = SendGrid เหมือนเดิมเป๊ะๆ
// ไม่กระทบ caller เดิม (signup verify/password reset/order notify/report digest ใช้ sendEmail() ตัวเดียวกัน)
// ตั้ง MAIL_PROVIDER=gmail + GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD เพื่อส่งผ่าน Gmail SMTP แทน
// ตั้ง MAIL_PROVIDER=smtp + SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM เพื่อส่งผ่าน SMTP relay
// ทั่วไป (Resend, Amazon SES, Postmark, Brevo, Mailgun ฯลฯ) — สลับเจ้าได้ด้วย env อย่างเดียว ไม่ต้องแก้โค้ด
type MailProvider = "sendgrid" | "gmail" | "smtp";

// แนบไฟล์ — ทั้ง SendGrid (`@sendgrid/mail`) และ nodemailer (Gmail SMTP) รองรับ attachment
// อยู่แล้วในระดับ SDK เพียงแต่ sendEmail() เดิมไม่เคย forward field นี้เข้าไปเลย (ใช้แค่ verify
// signup/order notify/report digest ที่ไม่มีไฟล์แนบ) — เพิ่มเป็น optional เพื่อไม่กระทบ caller เดิม
export type MailAttachment = {
  filename: string;
  /** เนื้อไฟล์ดิบ — SendGrid ต้องการ base64 string (แปลงให้ตอนส่งใน sendViaSendGrid), nodemailer รับ Buffer ตรงๆ */
  content: Buffer;
  mimeType: string;
};

type SendOpts = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
};

function currentProvider(): MailProvider {
  const raw = (process.env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "gmail") return "gmail";
  if (raw === "smtp") return "smtp";
  return "sendgrid";
}

// reply-to มาจากข้อมูลที่ร้านพิมพ์เอง (contact_email) — ค่าที่ไม่ใช่อีเมลเดี่ยว ๆ ทิ้งไปเฉย ๆ
// แทนที่จะทำให้การส่งล้ม (ใบเสร็จที่ส่งไม่ออกเพราะร้านพิมพ์อีเมลติดต่อผิด แย่กว่าไม่มี reply-to)
// และกันขึ้นบรรทัดใหม่ที่อาจกลายเป็น header injection
export function normalizeReplyTo(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!v || /[\r\n,;]/.test(v)) return undefined;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? v : undefined;
}

// SendGrid key/from เคยตั้งชื่อขึ้นต้น NEXT_PUBLIC_ ซึ่งผิดสำหรับความลับ (Next ฝังค่า NEXT_PUBLIC_*
// ลง bundle ฝั่ง browser ทันทีที่ไฟล์ฝั่ง client อ้างถึง) — อ่านชื่อใหม่ก่อน แล้ว fallback ชื่อเดิม
// เพื่อไม่ให้ production ที่ยังตั้งชื่อเดิมพังตอน deploy
function sendgridApiKey(): string | undefined {
  return process.env.SENDGRID_API_KEY || process.env.NEXT_PUBLIC_SENDGRID_API_KEY || undefined;
}

function sendgridFromEmail(): string | undefined {
  return process.env.SENDGRID_FROM_EMAIL || process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL || undefined;
}

// ---------------- SendGrid ----------------

let sendgridInitialized = false;

function initSendGrid() {
  if (sendgridInitialized) return;

  const key = sendgridApiKey();
  if (!key) {
    // log ตอน init พัง
    addLog(
      "error",
      "email",
      "SendGrid init failed: missing API key",
      { env: "SENDGRID_API_KEY (หรือชื่อเดิม NEXT_PUBLIC_SENDGRID_API_KEY)" }
    );
    throw new Error("Missing SENDGRID_API_KEY");
  }

  sgMail.setApiKey(key);
  // Abort stalled provider requests; signup awaits delivery before responding.
  sgMail.setTimeout(20_000);
  sendgridInitialized = true;
}

async function sendViaSendGrid(opts: SendOpts) {
  const from = sendgridFromEmail();

  if (!from) {
    addLog(
      "error",
      "email",
      "SendGrid send failed: missing FROM email",
      { env: "SENDGRID_FROM_EMAIL (หรือชื่อเดิม NEXT_PUBLIC_SENDGRID_FROM_EMAIL)" }
    );
    throw new Error("Missing SENDGRID_FROM_EMAIL");
  }

  try {
    initSendGrid();

    const [res] = await sgMail.send({
      to: opts.to,
      from,
      replyTo: opts.replyTo,
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
    dnsTimeout: 5_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return gmailTransporter;
}

async function sendViaGmail(opts: SendOpts) {
  const user = process.env.GMAIL_SMTP_USER;
  const fromName = process.env.GMAIL_SMTP_FROM_NAME;

  try {
    const transporter = getGmailTransporter();
    const info = await transporter.sendMail({
      from: fromName ? `${fromName} <${user}>` : user,
      replyTo: opts.replyTo,
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

// ---------------- Generic SMTP relay ----------------
// ใช้กับผู้ให้บริการที่ให้ SMTP credential (Resend: host smtp.resend.com, user "resend", pass = API key ·
// Amazon SES: email-smtp.<region>.amazonaws.com · Postmark/Brevo/Mailgun ก็รูปแบบเดียวกัน)
// พอร์ต 465/2465 = SSL ตั้งแต่ต้น · พอร์ตอื่น (587/2587/25) = STARTTLS และบังคับ TLS เสมอ
// (ห้ามยอมส่ง credential/เนื้ออีเมลแบบไม่เข้ารหัสเมื่อ server ไม่เสนอ STARTTLS)
// MAIL_FROM ต้องเป็นอีเมลบนโดเมนที่ verify กับผู้ให้บริการแล้ว เช่น "BMS <no-reply@mail.example.com>"

let smtpTransporter: nodemailer.Transporter | null = null;

export function smtpTransportOptions(env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  const port = Number(env.SMTP_PORT || 587);
  if (!host || !user || !pass) {
    throw new Error("Missing SMTP_HOST/SMTP_USER/SMTP_PASS");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
  }
  const secure = port === 465 || port === 2465;
  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    dnsTimeout: 5_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

function getSmtpTransporter(): nodemailer.Transporter {
  if (smtpTransporter) return smtpTransporter;
  try {
    smtpTransporter = nodemailer.createTransport(smtpTransportOptions());
  } catch (err: any) {
    addLog("error", "email", "SMTP init failed", {
      env: "SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS",
      error: err?.message,
    });
    throw err;
  }
  return smtpTransporter;
}

async function sendViaSmtp(opts: SendOpts) {
  const from = process.env.MAIL_FROM?.trim();
  if (!from) {
    addLog("error", "email", "SMTP send failed: missing FROM", { env: "MAIL_FROM" });
    throw new Error("Missing MAIL_FROM");
  }

  try {
    const transporter = getSmtpTransporter();
    const info = await transporter.sendMail({
      from,
      replyTo: opts.replyTo,
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

    await addLog("info", "email", "Email sent successfully (smtp)", {
      to: opts.to,
      subject: opts.subject,
      host: process.env.SMTP_HOST,
      messageId: info?.messageId,
      response: info?.response,
    });

    return { statusCode: 250, messageId: info?.messageId };
  } catch (err: any) {
    await addLog("error", "email", "Email send failed (smtp)", {
      to: opts.to,
      subject: opts.subject,
      host: process.env.SMTP_HOST,
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
  if (provider === "smtp") return process.env.MAIL_FROM?.trim() || null;
  return sendgridFromEmail() ?? null;
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
    /** ให้ลูกค้ากดตอบแล้วถึงร้าน ไม่ใช่ถึงแพลตฟอร์ม — ค่าที่ไม่ใช่อีเมลเดี่ยวถูกทิ้ง (ดู normalizeReplyTo) */
    replyTo?: string | null;
  },
  meta: { tenantId?: string | null; category?: MailLogCategory; triggeredBy?: string | null } = {}
) {
  const provider = currentProvider();
  const send: SendOpts = { ...opts, replyTo: normalizeReplyTo(opts.replyTo) };

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
    const result =
      provider === "gmail" ? await sendViaGmail(send)
      : provider === "smtp" ? await sendViaSmtp(send)
      : await sendViaSendGrid(send);
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
