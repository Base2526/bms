// GraphQL resolver — BMS store profile (ข้อมูลร้าน + ค่าส่ง)
// gate ด้วย requireTenantAdmin เดียวกับ bmsAiConfig/bmsChannels (config domain, ไม่มี permission ใหม่)
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import {
  getBusinessArchetypeLockState,
  getStoreProfile,
  upsertStoreProfile,
  type StoreProfileInput,
} from "@/lib/bms/storeProfile";
import { getVatSettings } from "@/lib/bms/taxDocuments";
import { updateTenantIdentity } from "@/lib/bms/platform";
import { audit } from "@/lib/bms/audit";
import { getOnboardingProgress, updateOnboardingProgress } from "@/lib/bms/onboarding";

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
      const tenantId = getTenantId(ctx);
      // vatRegistered ไม่ได้อยู่ใน getStoreProfile() (มี cache อ่านผ่าน) จึงอ่านจาก
      // ตัวเดียวกับที่ออกใบกำกับใช้ — ฟอร์มสินค้าต้องรู้ว่าจะถามประเภท VAT ไหม
      const [profile, archetypeLock, vat] = await Promise.all([
        getStoreProfile(tenantId),
        getBusinessArchetypeLockState(tenantId),
        getVatSettings(tenantId),
      ]);
      return {
        ...profile,
        businessArchetypeLocked: archetypeLock.locked,
        vatRegistered: vat.vatRegistered,
      };
    },
    async bmsOnboardingProgress(_p: unknown, _a: unknown, ctx: any) {
      requireTenantAdmin(ctx);
      return getOnboardingProgress(getTenantId(ctx));
    },
  },
  Mutation: {
    async bmsUpsertStoreProfile(_p: unknown, args: { input: StoreProfileInput }, ctx: any) {
      requireTenantAdmin(ctx);
      try {
        const tenantId = getTenantId(ctx);
        const result = await upsertStoreProfile(tenantId, args.input ?? {}, ctx?.admin?.id ?? null);
        const [archetypeLock, vat] = await Promise.all([
          getBusinessArchetypeLockState(tenantId),
          getVatSettings(tenantId),
        ]);
        await audit(ctx, "store.profile_update", null, {});
        return {
          ...result,
          businessArchetypeLocked: archetypeLock.locked,
          vatRegistered: vat.vatRegistered,
        };
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกข้อมูลร้านไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsUpdateOnboardingProgress(
      _p: unknown,
      args: { completed?: string[] | null; skipped?: string[] | null; dismissed?: boolean | null },
      ctx: any
    ) {
      requireTenantAdmin(ctx);
      const result = await updateOnboardingProgress({
        tenantId: getTenantId(ctx),
        completed: args.completed,
        skipped: args.skipped,
        dismissed: args.dismissed,
        editorId: ctx?.admin?.id ?? null,
      });
      await audit(ctx, "onboarding.progress_update", null, {
        completed: result.completed,
        skipped: result.skipped,
        dismissed: Boolean(result.dismissedAt),
      });
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
