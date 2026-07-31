// GraphQL resolver — BMS Mail Log (super admin เท่านั้น, ดู db/migrations/7.40)
// เขียนจาก sendEmail() ใน lib/mailer.ts เพียงจุดเดียว — ที่นี่มีแค่ read path
import { requirePlatformAdmin } from "@/lib/bms/platform";
import { listMailLog, getMailLog, getMailLogStats, type MailLogFilter } from "@/lib/bms/mailLog";

export const bmsMailLogResolvers = {
  Query: {
    async bmsMailLog(_p: unknown, args: MailLogFilter, ctx: any) {
      await requirePlatformAdmin(ctx);
      return listMailLog(args);
    },
    async bmsMailLogEntry(_p: unknown, args: { id: string }, ctx: any) {
      await requirePlatformAdmin(ctx);
      return getMailLog(args.id);
    },
    async bmsMailLogStats(_p: unknown, _a: unknown, ctx: any) {
      await requirePlatformAdmin(ctx);
      return getMailLogStats();
    },
  },
};
