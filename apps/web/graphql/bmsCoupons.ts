// GraphQL resolvers — BMS Coupons (โค้ดส่วนลด)
// permission: coupon.view (อ่าน) / coupon.manage (สร้าง/แก้/ลบ) — เฉพาะ Manager/Administrator
import { listCoupons, upsertCoupon, deleteCoupon, listCouponRedemptions, assignCouponToCustomer, type UpsertCouponInput } from "@/lib/bms/coupons";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { requireAuth } from "@/lib/auth";
import { GraphQLError } from "graphql/error";
import { resolveActiveCustomerId } from "@/lib/bms/customers";
import { query } from "@/lib/db";

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
        const coupon = await upsertCoupon(getTenantId(ctx), args.input, requireAuth(ctx).author_id);
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
    async bmsAssignCouponToCustomer(
      _p: unknown,
      args: { customerId?: string | null; channel?: string | null; customerRef?: string | null; conversationId?: string | null; code: string; note?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "coupon.manage");
      const auth = requireAuth(ctx);
      const tenantId = getTenantId(ctx);
      let customerId = args.customerId ?? null;
      let channel = args.channel ?? null;
      let customerRef = args.customerRef ?? null;

      if (args.conversationId) {
        const conv = await query<{ customer_id: string | null; channel: string; customer_ref: string | null }>(
          `SELECT customer_id, channel, customer_ref
             FROM bms_conversations
            WHERE tenant_id = $1 AND id = $2
            LIMIT 1`,
          [tenantId, args.conversationId]
        );
        if (conv.rows[0]) {
          customerId = conv.rows[0].customer_id ?? customerId;
          channel = conv.rows[0].channel ?? channel;
          customerRef = conv.rows[0].customer_ref ?? customerRef;
        }
      }

      const activeCustomerId = await resolveActiveCustomerId(tenantId, customerId, {
        channel,
        customerRef,
      });
      if (!activeCustomerId) {
        throw new GraphQLError("ไม่พบลูกค้าในระบบสำหรับแชทนี้", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const ok = await assignCouponToCustomer(tenantId, activeCustomerId, args.code, {
        actor: auth.author_id == null ? null : String(auth.author_id),
        source: "MANUAL_CUSTOMER360",
        note: args.note ?? null,
      });
      if (!ok) {
        throw new GraphQLError("ไม่พบคูปองนี้ หรือยังไม่สามารถแจกให้ลูกค้าได้", { extensions: { code: "BAD_USER_INPUT" } });
      }
      await audit(ctx, "coupon.assign_customer", activeCustomerId, { code: String(args.code || "").trim().toUpperCase() });
      return true;
    },
  },
};
