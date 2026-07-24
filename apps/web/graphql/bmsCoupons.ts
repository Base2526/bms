// GraphQL resolvers — BMS Coupons (โค้ดส่วนลด)
// permission: coupon.view (อ่าน) / coupon.manage (สร้าง/แก้/ลบ) — เฉพาะ Manager/Administrator
import { listCoupons, upsertCoupon, deleteCoupon, listCouponRedemptions, type UpsertCouponInput } from "@/lib/bms/coupons";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { GraphQLError } from "graphql/error";

export const bmsCouponsResolvers = {
  Query: {
    async bmsCoupons(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "coupon.view");
      return listCoupons(getTenantId(ctx));
    },
    async bmsCouponRedemptions(_p: unknown, args: { couponId: string }, ctx: any) {
      await requirePermission(ctx, "coupon.view");
      return listCouponRedemptions(getTenantId(ctx), args.couponId);
    },
  },
  Mutation: {
    async bmsUpsertCoupon(_p: unknown, args: { input: UpsertCouponInput }, ctx: any) {
      await requirePermission(ctx, "coupon.manage");
      try {
        const coupon = await upsertCoupon(getTenantId(ctx), args.input);
        await audit(ctx, "coupon.upsert", coupon.id, { code: coupon.code });
        return coupon;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกโค้ดส่วนลดไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsDeleteCoupon(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "coupon.manage");
      const ok = await deleteCoupon(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "coupon.delete", args.id);
      return ok;
    },
  },
};
