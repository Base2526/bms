// apps/web/lib/passwordReset.ts
import crypto from "crypto";
import { query } from "@/lib/db";
import {
  buildPasswordResetUrl,
  hashResetToken,
  RESET_TOKEN_TTL_MIN,
} from "@/lib/auth/resetToken";

export { buildPasswordResetUrl, RESET_TOKEN_TTL_MIN } from "@/lib/auth/resetToken";

export async function createResetToken(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);
  await query(
    `WITH invalidated AS (
       UPDATE password_reset_tokens SET used = TRUE
        WHERE user_id = $1 AND used = FALSE
     )
     INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
     VALUES ($1,$2,$3,FALSE)`,
    [userId, hashResetToken(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function invalidateResetToken(token: string): Promise<void> {
  await query(`UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1`, [hashResetToken(token)]);
}

// ตัวอย่าง placeholder สำหรับส่งอีเมล (เปลี่ยนเป็น provider ของคุณ)
// export async function sendPasswordResetEmail(toEmail: string, resetUrl: string) {
//   console.log("[SEND RESET EMAIL] to:", toEmail, " link:", resetUrl);
//   // ใช้ SMTP/Sendgrid/SES ตามระบบคุณ
// }
import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/mailer";
import { addLog } from "@/lib/log/log.server";

// Prefer the server-only brand name; keep NEXT_PUBLIC_WEB_NAME for existing deployments.
function baseData(locale: string) {
  return {
    app_name: process.env.WEB_NAME ?? process.env.NEXT_PUBLIC_WEB_NAME ?? "BMS",
    support_url: process.env.NEXT_PUBLIC_SUPPORT_URL ?? "https://bms.jachoei.com/support",
    year: new Date().getFullYear(),
    locale,
  };
}

function defaultResetEmailTemplate(locale: string, data: {
  user_name: string;
  reset_url: string;
  expiry_minutes: number;
}) {
  const userName = escapeHtml(data.user_name);
  const resetUrl = escapeHtml(data.reset_url);
  if (locale === "th") {
    return {
      subject: "รีเซ็ตรหัสผ่านของคุณ",
      html: `<h2>รีเซ็ตรหัสผ่าน</h2><p>สวัสดี ${userName}</p><p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p><p><a href="${resetUrl}">รีเซ็ตรหัสผ่าน</a></p><p>ลิงก์นี้มีอายุ ${data.expiry_minutes} นาที</p><p>ถ้าคุณไม่ได้ร้องขอการรีเซ็ต ให้ละเว้นอีเมลฉบับนี้ได้เลย</p>`,
      text: `รีเซ็ตรหัสผ่าน: ${data.reset_url} (ลิงก์มีอายุ ${data.expiry_minutes} นาที)`,
    };
  }

  return {
    subject: "Reset your password",
    html: `<h2>Reset your password</h2><p>Hello ${userName},</p><p>Use the link below to set a new password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in ${data.expiry_minutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
    text: `Reset your password: ${data.reset_url} (expires in ${data.expiry_minutes} minutes)`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** เนื้อ HTML มีข้อความที่คนอ่านเห็นจริงไหม (ตัด tag/entity ออกก่อน) */
function htmlHasVisibleText(html: string): boolean {
  const stripped = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0;
}

/**
 * template จาก DB ใช้ได้จริงไหม — ถ้าไม่ผ่านจะ fallback ไป `defaultResetEmailTemplate()`
 *
 * ⚠️ เดิมเช็คแค่ `subject && (html || text)` ว่างเปล่าหรือไม่ ซึ่ง **หลวมเกินไป**: template ที่
 * render ออกมาเป็นโครง HTML เปล่า ๆ (เช่น `<html><body></body></html>` เพราะอ้างตัวแปรที่โค้ด
 * ปัจจุบันไม่ได้ส่งเข้าไป — Mustache แทนตัวแปรที่ไม่มีด้วยสตริงว่าง) ยังนับว่า "ไม่ว่าง" เพราะ
 * `.trim()` เห็นแท็กเป็นตัวอักษร → ส่งอีเมลเปล่าออกไปจริงโดยไม่มี error ใด ๆ (เคสที่เจอจริง:
 * ผู้ใช้ได้อีเมลที่มีแต่หัวข้อ เนื้อในว่างทั้งฉบับ)
 *
 * เกณฑ์ที่ถูกต้องคือ **ต้องมีลิงก์รีเซ็ตอยู่ในเนื้ออีเมลจริง** — อีเมลรีเซ็ตรหัสผ่านที่ไม่มีลิงก์
 * ไม่มีประโยชน์เลย ไม่ว่าจะสวยแค่ไหน
 */
function isRenderedTemplateUsable(
  rendered: { subject?: string; html?: string; text?: string },
  resetUrl: string
) {
  const subject = String(rendered.subject || "").trim();
  if (!subject) return false;

  const html = String(rendered.html || "");
  const text = String(rendered.text || "");

  // ลิงก์รีเซ็ตต้องโผล่ในฝั่งใดฝั่งหนึ่ง
  const hasLink = html.includes(resetUrl) || text.includes(resetUrl);
  if (!hasLink) return false;

  // และเนื้อที่ส่งต้องมีอะไรให้อ่านจริง
  return htmlHasVisibleText(html) || text.trim().length > 0;
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
    expiry_minutes: args.expiryMinutes ?? RESET_TOKEN_TTL_MIN,
    request_ip: args.requestIp ?? "-",
    request_device: args.requestDevice ?? "-",
    request_time: args.requestTime ?? new Date().toISOString(),
  };

  let rendered:
    | { subject: string; html: string; text?: string }
    | { subject: string; html: string; text: string };

  const fallback = () =>
    defaultResetEmailTemplate(locale, {
      user_name: templateData.user_name,
      reset_url: templateData.reset_url,
      expiry_minutes: templateData.expiry_minutes,
    });

  try {
    const tpl = await getLatestEmailTemplate("auth.reset", locale);
    rendered = renderEmailTemplate(tpl, templateData);
    if (!isRenderedTemplateUsable(rendered, templateData.reset_url)) {
      // template ใน DB ใช้ไม่ได้ (ไม่มีลิงก์/เนื้อว่าง) — log ไว้ให้ตามได้ว่าเป็น row ไหน
      // ไม่งั้นอาการ "อีเมลมาแต่เนื้อว่าง" จะเงียบสนิทเหมือนที่เจอมา
      await addLog("warn", "email", "auth.reset template unusable — fell back to built-in", {
        templateId: tpl.id,
        key: tpl.key,
        locale: tpl.locale,
        version: tpl.version,
      });
      rendered = fallback();
    }
  } catch {
    rendered = fallback();
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
