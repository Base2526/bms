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

  // 1) load template from PG
  const tpl = await getLatestEmailTemplate("auth.reset", locale);

  // 2) render variables
  const rendered = renderEmailTemplate(tpl, {
    ...baseData(locale),
    user_name: args.userName ?? args.to,
    reset_url: args.resetUrl,
    expiry_minutes: args.expiryMinutes ?? 30,
    request_ip: args.requestIp ?? "-",
    request_device: args.requestDevice ?? "-",
    request_time: args.requestTime ?? new Date().toISOString(),
  });

  // 3) send email via SendGrid
  await sendEmail({
    to: args.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

