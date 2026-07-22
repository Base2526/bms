// GraphQL resolver — BMS store profile (ข้อมูลร้าน + ค่าส่ง)
// gate ด้วย requireTenantAdmin เดียวกับ bmsAiConfig/bmsChannels (config domain, ไม่มี permission ใหม่)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { getStoreProfile, upsertStoreProfile, type StoreProfileInput } from "@/lib/bms/storeProfile";
import { updateTenantIdentity } from "@/lib/bms/platform";
import { audit } from "@/lib/bms/audit";

function requireTenantAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

export const bmsStoreProfileResolvers = {
  Query: {
    async bmsStoreProfile(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return getStoreProfile(getTenantId(ctx));
    },
  },
  Mutation: {
    async bmsUpsertStoreProfile(_p: unknown, args: { input: StoreProfileInput }, ctx: any) {
      requireTenantAdmin(ctx);
      const result = await upsertStoreProfile(getTenantId(ctx), args.input ?? {}, ctx?.admin?.id ?? null);
      await audit(ctx, "store.profile_update", null, {});
      return result;
    },
    // แก้ชื่อร้าน (tenant name) + slug — Administrator ของร้านแก้เองได้
    async bmsUpdateMyTenant(_p: unknown, args: { name?: string; slug?: string }, ctx: any) {
      requireTenantAdmin(ctx);
      try {
        const t = await updateTenantIdentity(getTenantId(ctx), { name: args.name ?? null, slug: args.slug ?? null });
        await audit(ctx, "tenant.identity_update", t.id, { name: t.name, slug: t.slug });
        return t;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "แก้ข้อมูลร้านไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
