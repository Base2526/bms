// GraphQL resolver — BMS Dev SQL Console (platform admin only)
// ดู lib/bms/sqlConsole.ts สำหรับ guard/validation logic เต็มรูปแบบ
import { requirePlatformAdmin } from "@/lib/bms/platform";
import { audit } from "@/lib/bms/audit";
import { runReadOnlySql, runSql, sqlConsoleWriteDisabled } from "@/lib/bms/sqlConsole";
import { jsConsoleEnabled, runSandboxedJs } from "@/lib/bms/jsConsole";

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
  },
};
