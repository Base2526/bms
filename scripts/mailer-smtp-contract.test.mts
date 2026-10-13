import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeReplyTo, smtpTransportOptions } from "../apps/web/lib/mailer.ts";

/**
 * MAIL_PROVIDER=smtp — SMTP relay ทั่วไป (Resend, Amazon SES, Postmark, Brevo, Mailgun)
 *
 * สิ่งที่ไฟล์นี้ตรึง:
 *   1. พอร์ตที่ไม่ใช่ 465/2465 ต้องบังคับ STARTTLS — ไม่งั้น credential กับเนื้อใบเสร็จวิ่งแบบไม่เข้ารหัส
 *      เมื่อ server ไม่เสนอ STARTTLS
 *   2. bms_mail_log.provider ต้องรับ 'smtp' — ไม่งั้น recordMailLog() กลืน CHECK violation เงียบ ๆ
 *      แล้วหน้า /admin/mail-log ว่างทั้งที่อีเมลส่งออกจริง
 *   3. reply-to ที่ร้านพิมพ์ผิดต้องถูกทิ้ง ไม่ใช่ทำให้การส่งล้ม และกัน header injection
 *   4. SendGrid ยังอ่านชื่อ env เดิม (NEXT_PUBLIC_*) ได้ ไม่งั้น production ที่ยังไม่เปลี่ยนชื่อพังตอน deploy
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");
const withoutComments = (src: string) =>
  src
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const baseEnv = { SMTP_HOST: "smtp.resend.com", SMTP_USER: "resend", SMTP_PASS: "re_test" } as NodeJS.ProcessEnv;

test("SMTP ports 465/2465 use implicit TLS; every other port must require STARTTLS", () => {
  for (const port of ["465", "2465"]) {
    const o = smtpTransportOptions({ ...baseEnv, SMTP_PORT: port });
    assert.equal(o.secure, true, `port ${port}`);
    assert.equal(o.requireTLS, false, `port ${port}`);
  }
  for (const port of ["587", "2587", "25"]) {
    const o = smtpTransportOptions({ ...baseEnv, SMTP_PORT: port });
    assert.equal(o.secure, false, `port ${port}`);
    assert.equal(o.requireTLS, true, `port ${port} must refuse plaintext delivery`);
  }
  const defaults = smtpTransportOptions(baseEnv);
  assert.equal(defaults.port, 587);
  assert.equal(defaults.requireTLS, true);
  assert.deepEqual(defaults.auth, { user: "resend", pass: "re_test" });
});

test("SMTP config refuses to start without credentials or with a nonsense port", () => {
  assert.throws(() => smtpTransportOptions({ SMTP_HOST: "smtp.resend.com" } as NodeJS.ProcessEnv), /^Error: Missing SMTP_/);
  assert.throws(() => smtpTransportOptions({ ...baseEnv, SMTP_PORT: "abc" }), /Invalid SMTP_PORT/);
  assert.throws(() => smtpTransportOptions({ ...baseEnv, SMTP_PORT: "70000" }), /Invalid SMTP_PORT/);
});

test("reply-to accepts one plain address and drops anything else instead of failing the send", () => {
  assert.equal(normalizeReplyTo(" shop@example.co.th "), "shop@example.co.th");
  for (const bad of [
    null,
    undefined,
    "",
    "not-an-email",
    "a@b.com, c@d.com",
    "a@b.com;c@d.com",
    // ผ่าน regex อีเมล แต่ใน header จะถูกแยกเป็นผู้รับสองคน
    "a,b@example.com",
    "a;b@example.com",
    "shop@example.com\r\nBcc: victim@example.com",
    "Shop <shop@example.com>",
  ]) {
    assert.equal(normalizeReplyTo(bad), undefined, String(bad));
  }
});

test("sendEmail dispatches MAIL_PROVIDER=smtp and passes reply-to to every provider", () => {
  const src = withoutComments(read("apps/web/lib/mailer.ts"));
  assert.ok(/raw === "smtp"\) return "smtp"/.test(src), "currentProvider must recognise smtp");
  assert.ok(/provider === "smtp" \? await sendViaSmtp\(send\)/.test(src), "sendEmail must route smtp to sendViaSmtp");
  assert.ok(/replyTo: normalizeReplyTo\(opts\.replyTo\)/.test(src), "reply-to must be normalised once at the entrypoint");
  const replyToUses = src.match(/replyTo: opts\.replyTo/g) ?? [];
  assert.equal(replyToUses.length, 3, "SendGrid, Gmail and SMTP must all forward reply-to");
  assert.ok(/process\.env\.SENDGRID_API_KEY \|\| process\.env\.NEXT_PUBLIC_SENDGRID_API_KEY/.test(src),
    "SendGrid must keep reading the legacy env name until production is renamed");
});

test("bms_mail_log accepts provider 'smtp' (latest migration that touches the CHECK wins)", () => {
  const dir = `${root}db/migrations/`;
  const files = readdirSync(dir)
    .filter((f) => /^\d+\.\d+__.*\.sql$/.test(f))
    .sort((a, b) => {
      const [am, an] = a.split("__")[0].split(".").map(Number);
      const [bm, bn] = b.split("__")[0].split(".").map(Number);
      return am - bm || an - bn;
    });
  const touching = files.filter((f) => /bms_mail_log[\s\S]*provider/.test(readFileSync(dir + f, "utf8")));
  assert.ok(touching.length > 0);
  const latest = readFileSync(dir + touching[touching.length - 1], "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(latest, /CHECK \(provider IN \('sendgrid', 'gmail', 'smtp'\)\)/);

  const mailLog = read("apps/web/lib/bms/mailLog.ts");
  assert.match(mailLog, /export type MailProvider = "sendgrid" \| "gmail" \| "smtp";/);
});

test("every compose file passes the SMTP env through to the web container", () => {
  for (const file of ["docker-compose.yml", "docker-compose.prod.yml", "docker-compose.dev.yml"]) {
    const src = read(file);
    for (const key of ["MAIL_PROVIDER", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]) {
      assert.ok(new RegExp(`^\\s+${key}: \\$\\{${key}`, "m").test(src), `${file} is missing ${key}`);
    }
  }
});

test("customer-facing mail replies reach the shop, not the platform sender", () => {
  assert.match(read("apps/web/lib/bms/receiptDelivery.ts"), /replyTo: data\.storeContactEmail/);
  assert.match(read("apps/web/lib/bms/orderNotify.ts"), /replyTo: profile\.contactEmail/);
});
