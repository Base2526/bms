// GraphQL resolver — BMS settings / channel connections (admin, per-tenant)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getTenantId } from "@/lib/bms/tenant";
import { listChannelsMasked, upsertChannel } from "@/lib/bms/channels";
import { listChannelHealth, countUnhealthyChannels, testChannelConnection } from "@/lib/bms/channelHealth";
import { audit } from "@/lib/bms/audit";

/** pg คืน timestamp เป็น Date object — ต้อง toISOString() ก่อนคืนใน field ที่เป็น String (ดู CLAUDE.local.md) */
function toISO(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

const ALLOWED = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"];

export const bmsChannelsResolvers = {
  Query: {
    async bmsMyTenant(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const res = await query(`SELECT id, name, slug FROM bms_tenants WHERE id = $1`, [getTenantId(ctx)]);
      return res.rows[0] ?? { id: getTenantId(ctx), name: "Default Shop", slug: "default" };
    },
    async bmsChannels(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return listChannelsMasked(getTenantId(ctx));
    },
    async bmsChannelHealth(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      const rows = await listChannelHealth(getTenantId(ctx));
      return rows.map((r) => ({
        ...r,
        last_error_at: toISO(r.last_error_at),
        last_inbound_event_at: toISO(r.last_inbound_event_at),
        last_outbound_success_at: toISO(r.last_outbound_success_at),
        last_checked_at: toISO(r.last_checked_at),
      }));
    },
    async bmsChannelHealthCount(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return countUnhealthyChannels(getTenantId(ctx));
    },
  },
  Mutation: {
    async bmsUpsertChannel(
      _p: unknown,
      args: { channel: string; accessToken?: string; channelSecret?: string; active?: boolean },
      ctx: any
    ) {
      requireTenantAdmin(ctx);
      if (!ALLOWED.includes(args.channel)) {
        throw new GraphQLError("channel ไม่ถูกต้อง", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const ok = await upsertChannel(getTenantId(ctx), args.channel, {
        accessToken: args.accessToken,
        channelSecret: args.channelSecret,
        active: args.active,
      });
      await audit(ctx, "channel.upsert", args.channel, { active: args.active });
      return ok;
    },
    async bmsTestChannel(_p: unknown, args: { channel: string }, ctx: any) {
      requireTenantAdmin(ctx);
      if (!ALLOWED.includes(args.channel)) {
        throw new GraphQLError("channel ไม่ถูกต้อง", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const result = await testChannelConnection(getTenantId(ctx), args.channel);
      await audit(ctx, "channel.test", args.channel, { ok: result.ok });
      return result;
    },
  },
};
