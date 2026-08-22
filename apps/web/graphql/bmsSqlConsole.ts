// GraphQL resolver — BMS Dev SQL Console (platform admin only)
// ดู lib/bms/sqlConsole.ts สำหรับ guard/validation logic เต็มรูปแบบ
import { requirePlatformAdmin } from "@/lib/bms/platform";
import { audit } from "@/lib/bms/audit";
import { runReadOnlySql, runSql, sqlConsoleWriteDisabled } from "@/lib/bms/sqlConsole";
import { jsConsoleEnabled, runSandboxedJs } from "@/lib/bms/jsConsole";
import { sendEmail } from "@/lib/mailer";
import { invalidEmails, parseRecipientList } from "@/lib/bms/reportRecipients";

// เก็บ query เต็มข้อความ (ไม่ตัดเหมือน ai.tool_call) — เจตนา: ต้อง trace กลับได้ว่า
// platform admin คนไหนรันอะไรไปบ้าง, ยาวสุด 2000 ตัวอักษรกัน log บวมถ้าใครวางไฟล์ยาวผิด
function auditSql(ctx: any, action: string, sql: string, result: { ok: boolean; rowCount: number; durationMs: number; error: string | null }) {
  return audit(ctx, action, null, {
    sql: sql.slice(0, 2000),
    ok: result.ok,
    rowCount: result.rowCount,
    durationMs: result.durationMs,
    error: result.error,
  });
}

export const bmsSqlConsoleResolvers = {
  Query: {
    async bmsSqlConsoleWriteEnabled(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return !sqlConsoleWriteDisabled();
    },
    async bmsJsConsoleEnabled(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return jsConsoleEnabled();
    },
  },
  Mutation: {
    async bmsRunReadOnlySql(_p: unknown, args: { sql: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      const result = await runReadOnlySql(args.sql);
      await auditSql(ctx, "dev.sql_console.read", args.sql, result);
      return result;
    },
    async bmsRunSql(_p: unknown, args: { sql: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      const result = await runSql(args.sql);
      await auditSql(ctx, "dev.sql_console.write", args.sql, result);
      return result;
    },
    async bmsRunSandboxedJs(_p: unknown, args: { code: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      const result = await runSandboxedJs(args.code);
      await audit(ctx, "dev.js_console.run", null, {
        code: args.code.slice(0, 4000),
        codeTruncated: args.code.length > 4000,
        ok: result.ok,
        logCount: result.logs.length,
        durationMs: result.durationMs,
        error: result.error,
      });
      return result;
    },
    async bmsSendTestEmail(_p: unknown, args: { to: string; html?: string | null }, ctx: any) {
      await requirePlatformAdmin(ctx);

      const recipients = parseRecipientList(String(args.to || "").replace(/[\n;]+/g, ","));
      const badEmails = invalidEmails(recipients);
      if (!recipients.length) {
        return { ok: false, message: "กรุณาระบุอีเมลผู้รับอย่างน้อย 1 รายการ", sent: 0, details: [] };
      }
      if (badEmails.length) {
        return { ok: false, message: `อีเมลไม่ถูกต้อง: ${badEmails.join(", ")}`, sent: 0, details: badEmails };
      }

      const sentAt = new Date().toISOString();
      const html = String(args.html || "").trim() || `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="margin:0 0 12px">BMS test email</h2><p>This is a test email from <code>/admin/dev/sql-console</code>.</p><p>Sent at: <code>${sentAt}</code></p></div>`;
      const details: string[] = [];
      let sent = 0;

      for (const to of recipients) {
        try {
          const { messageId, statusCode } = await sendEmail(
            {
              to,
              subject: `BMS test email • ${sentAt}`,
              text: `This is a test email from /admin/dev/sql-console at ${sentAt}.`,
              html,
            },
            { category: "test", triggeredBy: `admin:${ctx?.admin?.email || ctx?.admin?.id || "unknown"}` }
          );
          sent += 1;
          details.push(`${to}: ส่งสำเร็จ${messageId ? ` (id: ${messageId})` : statusCode ? ` (status: ${statusCode})` : ""}`);
        } catch (err: any) {
          const providerErrors = err?.response?.body?.errors;
          const providerMessage = Array.isArray(providerErrors) && providerErrors.length
            ? providerErrors.map((x: any) => x?.message || JSON.stringify(x)).join("; ")
            : err?.responseCode && typeof err?.response === "string"
              ? `SMTP ${err.responseCode}: ${err.response}`
              : err?.message || "ส่งอีเมลไม่สำเร็จ";
          details.push(`${to}: ${providerMessage}`);
        }
      }

      const ok = sent === recipients.length;
      await audit(ctx, "dev.email_test.send", null, {
        recipients: recipients.slice(0, 20),
        recipientCount: recipients.length,
        sent,
        ok,
        detailsPreview: details.slice(0, 20),
      });

      return {
        ok,
        message: ok ? "ส่งอีเมลทดสอบสำเร็จ" : sent > 0 ? "ส่งอีเมลได้บางส่วน" : "ส่งอีเมลไม่สำเร็จ",
        sent,
        details,
      };
    },
  },
};
