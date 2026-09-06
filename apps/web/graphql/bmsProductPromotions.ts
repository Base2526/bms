// GraphQL resolvers — โปรโมชันต่อสินค้า (8.7) พร้อมขอบเขตสาขา (9.61)
// permission: product.view (อ่าน) / product.edit (ตั้ง-ปิด) — เหตุผลของ 8.7 คือ
// การตั้งโปรเท่ากับการตั้งราคาขายของสินค้านั้น จึงไม่มี permission ใหม่ให้ต้อง seed
import {
  listProductPromotions,
  upsertProductPromotion,
  deactivateProductPromotion,
  type PromotionKind,
} from "@/lib/bms/productPromotions";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { requireAuth } from "@/lib/auth";
import { GraphQLError } from "graphql/error";
import { listLocationsForUser, userCanAccessLocation, userHasLocationScope } from "@/lib/bms/locations";

type PromotionInput = {
  productSku: string;
  locationId?: string | null;
  kind: PromotionKind;
  buyQty: number;
  getQty?: number | null;
  bundlePrice?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
};

export const bmsProductPromotionsResolvers = {
  Query: {
    async bmsProductPromotions(
      _p: unknown,
      args: { productSku?: string | null; locationId?: string | null; includeInactive?: boolean | null },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      const tenantId = getTenantId(ctx);
      const auth = requireAuth(ctx);
      const userId = String(auth.author_id || "");
      // พนักงานที่ถูกจำกัดสาขาต้องไม่เห็นโปรของสาขาที่ตัวเองดูแลไม่ได้ — ไม่มีขอบเขต
      // = เห็นทั้งร้านเหมือนเดิม (bms_user_allowed_locations เป็น opt-in ตาม 9.37)
      let locationId = args.locationId ?? null;
      if (await userHasLocationScope(tenantId, userId)) {
        if (locationId) {
          if (!(await userCanAccessLocation(tenantId, userId, locationId))) {
            throw new GraphQLError("ไม่มีสิทธิ์ดูโปรโมชันของสาขานี้", { extensions: { code: "FORBIDDEN" } });
          }
        } else {
          const allowed = await listLocationsForUser(tenantId, userId);
          locationId = allowed[0]?.id ?? null;
        }
      }
      return listProductPromotions(tenantId, {
        productSku: args.productSku ?? null,
        locationId,
        includeInactive: Boolean(args.includeInactive),
      });
    },
    async bmsPromotionLocations(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      const auth = requireAuth(ctx);
      return listLocationsForUser(getTenantId(ctx), String(auth.author_id || ""));
    },
  },
  Mutation: {
    async bmsUpsertProductPromotion(_p: unknown, args: { input: PromotionInput }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const auth = requireAuth(ctx);
        const tenantId = getTenantId(ctx);
        const userId = String(auth.author_id || "");
        const locationId = args.input.locationId ?? null;
        if (await userHasLocationScope(tenantId, userId)) {
          // ผู้ใช้ที่ถูกจำกัดสาขาตั้งโปร "ทั้งร้าน" ไม่ได้ — โปรทั้งร้านมีผลกับสาขาที่เขา
          // ไม่ได้ดูแลด้วย ซึ่งกว้างกว่าขอบเขตที่ร้านตั้งใจให้เขามี
          if (!locationId) {
            throw new Error("ผู้ใช้ที่ถูกจำกัดสาขาต้องเลือกสาขาของโปรโมชัน (ตั้งโปรทั้งร้านไม่ได้)");
          }
          if (!(await userCanAccessLocation(tenantId, userId, locationId))) {
            throw new Error("ไม่มีสิทธิ์ตั้งโปรโมชันให้สาขานี้");
          }
        }
        const promotion = await upsertProductPromotion({
          tenantId,
          actorUserId: userId,
          productSku: args.input.productSku,
          locationId,
          kind: args.input.kind,
          buyQty: args.input.buyQty,
          getQty: args.input.getQty ?? null,
          bundlePrice: args.input.bundlePrice ?? null,
          startsAt: args.input.startsAt ?? null,
          endsAt: args.input.endsAt ?? null,
          note: args.input.note ?? null,
        });
        await audit(ctx, "product.promotion_saved", promotion.id, {
          sku: promotion.productSku, locationId: promotion.locationId, kind: promotion.kind,
        });
        return promotion;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกโปรโมชันไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsDeactivateProductPromotion(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      const auth = requireAuth(ctx);
      const tenantId = getTenantId(ctx);
      const userId = String(auth.author_id || "");
      if (await userHasLocationScope(tenantId, userId)) {
        const [existing] = await listProductPromotions(tenantId, { includeInactive: true, limit: 500 })
          .then((rows) => rows.filter((row) => row.id === String(args.id)));
        if (!existing) throw new GraphQLError("ไม่พบโปรโมชันนี้", { extensions: { code: "BAD_USER_INPUT" } });
        if (!existing.locationId || !(await userCanAccessLocation(tenantId, userId, existing.locationId))) {
          throw new GraphQLError("ไม่มีสิทธิ์ปิดโปรโมชันนี้", { extensions: { code: "FORBIDDEN" } });
        }
      }
      const ok = await deactivateProductPromotion({ tenantId, id: String(args.id), actorUserId: userId });
      if (ok) await audit(ctx, "product.promotion_deactivated", String(args.id));
      return ok;
    },
  },
};
