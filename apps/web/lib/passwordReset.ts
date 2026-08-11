// apps/web/lib/passwordReset.ts
import crypto from "crypto";
import { query } from "@/lib/db";

const RESET_TOKEN_TTL_MIN = 15; // 15 นาที

export async function createResetToken(userId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at, used)
     VALUES ($1,$2,$3,false)`,
    [userId, token, expiresAt]
  );
  return { token, expiresAt };
}

// ตัวอย่าง placeholder สำหรับส่งอีเมล (เปลี่ยนเป็น provider ของคุณ)
// export async function sendPasswordResetEmail(toEmail: string, resetUrl: string) {
//   console.log("[SEND RESET EMAIL] to:", toEmail, " link:", resetUrl);
//   // ใช้ SMTP/Sendgrid/SES ตามระบบคุณ
// }
import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/mailer";

function baseData(locale: string) {
  return {
    app_name: process.env.APP_NAME ?? "จ่าเฉย (JACHOEI)",
    support_url: process.env.SUPPORT_URL ?? "https://jachoei.com/support",
    year: new Date().getFullYear(),
    locale,
  };
}

function defaultResetEmailTemplate(locale: string, data: {
  user_name: string;
  reset_url: string;
  expiry_minutes: number;
}) {
  if (locale === "th") {
    return {
      subject: "รีเซ็ตรหัสผ่านของคุณ",
      html: `<h2>รีเซ็ตรหัสผ่าน</h2><p>สวัสดี ${data.user_name}</p><p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p><p><a href="${data.reset_url}">รีเซ็ตรหัสผ่าน</a></p><p>ลิงก์นี้มีอายุ ${data.expiry_minutes} นาที</p><p>ถ้าคุณไม่ได้ร้องขอการรีเซ็ต ให้ละเว้นอีเมลฉบับนี้ได้เลย</p>`,
      text: `รีเซ็ตรหัสผ่าน: ${data.reset_url} (ลิงก์มีอายุ ${data.expiry_minutes} นาที)`,
    };
  }

  return {
    subject: "Reset your password",
    html: `<h2>Reset your password</h2><p>Hello ${data.user_name},</p><p>Use the link below to set a new password:</p><p><a href="${data.reset_url}">Reset password</a></p><p>This link expires in ${data.expiry_minutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
    text: `Reset your password: ${data.reset_url} (expires in ${data.expiry_minutes} minutes)`,
  };
}

function isRenderedTemplateUsable(rendered: { subject?: string; html?: string; text?: string }) {
  return Boolean(
    String(rendered.subject || "").trim() &&
    (
      String(rendered.html || "").trim() ||
      String(rendered.text || "").trim()
    )
  );
}

export async function sendPasswordResetEmail(args: {
  to: string;
  locale?: string;
  userName?: string;
  resetUrl: string;
  expiryMinutes?: number;
  requestIp?: string;
  requestDevice?: string;
  requestTime?: string;
}) {
  const locale = args.locale ?? "en";
  const templateData = {
    ...baseData(locale),
    user_name: args.userName ?? args.to,
    reset_url: args.resetUrl,
    expiry_minutes: args.expiryMinutes ?? 30,
    request_ip: args.requestIp ?? "-",
    request_device: args.requestDevice ?? "-",
    request_time: args.requestTime ?? new Date().toISOString(),
  };

  let rendered:
    | { subject: string; html: string; text?: string }
    | { subject: string; html: string; text: string };

  try {
    const tpl = await getLatestEmailTemplate("auth.reset", locale);
    rendered = renderEmailTemplate(tpl, templateData);
    if (!isRenderedTemplateUsable(rendered)) {
      rendered = defaultResetEmailTemplate(locale, {
        user_name: templateData.user_name,
        reset_url: templateData.reset_url,
        expiry_minutes: templateData.expiry_minutes,
      });
    }
  } catch {
    rendered = defaultResetEmailTemplate(locale, {
      user_name: templateData.user_name,
      reset_url: templateData.reset_url,
      expiry_minutes: templateData.expiry_minutes,
    });
  }

  // 3) send email
  await sendEmail(
    {
      to: args.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { category: "auth", triggeredBy: "auth:password-reset" }
  );
}
