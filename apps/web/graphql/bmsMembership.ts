// GraphQL resolvers — BMS Membership (สมาชิก + ชั้น + แต้มสะสม)  migration 7.96
// permission: member.view (อ่าน) / member.manage (สมัคร-แก้) /
//             loyalty.adjust (ปรับแต้มมือ) / loyalty.settings (ตั้งค่าโปรแกรม+ชั้น)
//
// แก้ค่าพวกนี้ต้อง drill-down เข้าร้านเป้าหมายก่อน — ทุกอย่างอิง getTenantId(ctx)
// ถ้าไม่ได้เข้าร้านจะไปแก้ร้าน default เงียบ ๆ โดยไม่มี error เตือน
import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import {
  adjustPoints,
  countMembers,
  deleteMembershipTier,
  enrollMember,
  expireLoyaltyPoints,
  getLoyaltySettings,
  getMember,
  listLoyaltyLedger,
  listMembershipTiers,
  loyaltyActivityReport,
  loyaltyOutstandingReport,
  membersWithExpiringPoints,
  salesByTierReport,
  previewMemberDiscount,
  reviewAllMemberTiers,
  reviewMemberTier,
  searchMembers,
  updateLoyaltySettings,
  upsertMembershipTier,
  type UpdateLoyaltySettingsInput,
  type UpsertTierInput,
} from "@/lib/bms/membership";

function badInput(e: any, fallback: string): never {
  throw new GraphQLError(e?.message || fallback, { extensions: { code: "BAD_USER_INPUT" } });
}

export const bmsMembershipResolvers = {
  Query: {
    async bmsLoyaltySettings(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "member.view");
      return getLoyaltySettings(getTenantId(ctx));
    },
    async bmsMembershipTiers(_p: unknown, args: { activeOnly?: boolean | null }, ctx: any) {
      await requirePermission(ctx, "member.view");
      return listMembershipTiers(getTenantId(ctx), Boolean(args.activeOnly));
    },
    async bmsMembers(
      _p: unknown,
      args: { search?: string | null; limit?: number | null; offset?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "member.view");
      const tenantId = getTenantId(ctx);
      const search = args.search ?? "";
      const limit = args.limit ?? 25;
      const offset = args.offset ?? 0;
      const [members, total] = await Promise.all([
        searchMembers(tenantId, search, limit, offset),
        countMembers(tenantId, search),
      ]);
      return { members, total };
    },
    async bmsMember(_p: unknown, args: { customerId: string }, ctx: any) {
      await requirePermission(ctx, "member.view");
      return getMember(getTenantId(ctx), args.customerId);
    },
    async bmsLoyaltyLedger(_p: unknown, args: { customerId: string; limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "member.view");
      return listLoyaltyLedger(getTenantId(ctx), args.customerId, args.limit ?? 100);
    },
    async bmsLoyaltyOutstanding(_p: unknown, _a: unknown, ctx: any) {
      // ยอดแต้มค้าง = ภาระผูกพันของร้าน ผูกกับ report.view เพราะเป็นตัวเลขทางบัญชี
      await requirePermission(ctx, "report.view");
      return loyaltyOutstandingReport(getTenantId(ctx));
    },
    async bmsLoyaltyActivity(_p: unknown, args: { months?: number | null }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return loyaltyActivityReport(getTenantId(ctx), args.months ?? 6);
    },
    async bmsSalesByTier(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "report.view");
      return salesByTierReport(getTenantId(ctx));
    },
    async bmsMembersExpiringPoints(_p: unknown, args: { days?: number | null; limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "member.view");
      return membersWithExpiringPoints(getTenantId(ctx), args.days ?? 30, args.limit ?? 50);
    },
    async bmsMemberDiscountPreview(
      _p: unknown,
      args: { customerId?: string | null; subtotal: number; pointsToRedeem?: number | null; couponDiscount?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "member.view");
      return previewMemberDiscount({
        tenantId: getTenantId(ctx),
        customerId: args.customerId ?? null,
        subtotal: args.subtotal,
        pointsRequested: args.pointsToRedeem ?? 0,
        couponDiscount: args.couponDiscount ?? 0,
      });
    },
  },

  Mutation: {
    async bmsUpdateLoyaltySettings(_p: unknown, args: { input: UpdateLoyaltySettingsInput }, ctx: any) {
      await requirePermission(ctx, "loyalty.settings");
      try {
        const settings = await updateLoyaltySettings(getTenantId(ctx), args.input);
        await audit(ctx, "loyalty.settings.update", null, { ...args.input });
        return settings;
      } catch (e: any) {
        badInput(e, "บันทึกการตั้งค่าโปรแกรมสะสมแต้มไม่สำเร็จ");
      }
    },

    async bmsUpsertMembershipTier(_p: unknown, args: { input: UpsertTierInput }, ctx: any) {
      await requirePermission(ctx, "loyalty.settings");
      try {
        const tier = await upsertMembershipTier(getTenantId(ctx), args.input);
        await audit(ctx, "membership.tier.upsert", tier.id, { code: tier.code });
        return tier;
      } catch (e: any) {
        badInput(e, "บันทึกชั้นสมาชิกไม่สำเร็จ");
      }
    },

    async bmsDeleteMembershipTier(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "loyalty.settings");
      const res = await deleteMembershipTier(getTenantId(ctx), args.id);
      await audit(ctx, "membership.tier.delete", args.id, res);
      return res;
    },

    async bmsEnrollMember(
      _p: unknown,
      args: { phone: string; name?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "member.manage");
      const auth = requireAuth(ctx);
      try {
        return await enrollMember(getTenantId(ctx), {
          phone: args.phone,
          name: args.name ?? null,
          actorUserId: auth.author_id ? String(auth.author_id) : null,
        });
      } catch (e: any) {
        badInput(e, "สมัครสมาชิกไม่สำเร็จ");
      }
    },

    async bmsAdjustLoyaltyPoints(
      _p: unknown,
      args: { customerId: string; points: number; note: string },
      ctx: any
    ) {
      // แยกสิทธิ์จาก member.manage โดยตั้งใจ — ปรับแต้มคือการสร้างมูลค่าให้ลูกค้า
      await requirePermission(ctx, "loyalty.adjust");
      const auth = requireAuth(ctx);
      try {
        const res = await adjustPoints({
          tenantId: getTenantId(ctx),
          customerId: args.customerId,
          points: args.points,
          note: args.note,
          actorUserId: auth.author_id ? String(auth.author_id) : null,
        });
        // adjustPoints เขียน bms_audit_log ให้แล้วในทรานแซกชันเดียวกับ ledger
        return res;
      } catch (e: any) {
        badInput(e, "ปรับแต้มไม่สำเร็จ");
      }
    },

    async bmsReviewMemberTier(_p: unknown, args: { customerId?: string | null }, ctx: any) {
      await requirePermission(ctx, "member.manage");
      const tenantId = getTenantId(ctx);
      if (args.customerId) {
        const res = await reviewMemberTier(tenantId, args.customerId);
        await audit(ctx, "membership.tier.review", args.customerId, { changed: res.changed, tier: res.tier?.code ?? null });
        return { reviewed: 1, changed: res.changed ? 1 : 0 };
      }
      const res = await reviewAllMemberTiers(tenantId);
      await audit(ctx, "membership.tier.review_all", null, res);
      return res;
    },

    async bmsExpireLoyaltyPoints(_p: unknown, _a: unknown, ctx: any) {
      // ยังไม่มี cron จริงในระบบนี้ — ปุ่มในหน้าแอดมินคือทางเดียวที่ตัดแต้มหมดอายุได้
      await requirePermission(ctx, "loyalty.settings");
      const res = await expireLoyaltyPoints(getTenantId(ctx));
      await audit(ctx, "loyalty.expire", null, res);
      return res;
    },
  },
};
