// GraphQL resolver — BMS settings / channel connections (admin, per-tenant)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getTenantId } from "@/lib/bms/tenant";
import { listChannelsMasked, upsertChannel } from "@/lib/bms/channels";
import { audit } from "@/lib/bms/audit";

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
  },
};
