// GraphQL resolvers — บันไดราคาส่งตามจำนวนแยกสาขา (`8.1` + `9.65`)
// permission: product.view (อ่าน) / product.edit (ตั้ง) — เหตุผลเดียวกับโปรโมชัน (`8.7`):
// การตั้งขั้นราคาคือการตั้งราคาขายของสินค้านั้น จึงไม่มี permission ใหม่ให้ต้อง seed
import {
  listProductPriceTiers,
  replaceProductPriceTiers,
  type PriceTierInput,
} from "@/lib/bms/productPriceTiers";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { requireAuth } from "@/lib/auth";
import { GraphQLError } from "graphql/error";
import { listLocationsForUser, userCanAccessLocation, userHasLocationScope } from "@/lib/bms/locations";

type ReplaceInput = {
  productSku: string;
  locationId?: string | null;
  tiers: PriceTierInput[];
};

export const bmsProductPriceTiersResolvers = {
  Query: {
    async bmsProductPriceTiers(
      _p: unknown,
      args: { productSku?: string | null; locationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      const tenantId = getTenantId(ctx);
      const auth = requireAuth(ctx);
      const userId = String(auth.author_id || "");
      // ผู้ใช้ที่ถูกจำกัดสาขาเห็นได้เฉพาะบันไดของสาขาที่ดูแล บวกบันไดของทั้งร้าน
      // (ซึ่งมีผลกับสาขาของเขาด้วย จึงต้องเห็น ไม่งั้นราคาที่ขายอยู่จะอธิบายไม่ได้)
      let allowed: string[] | undefined;
      if (await userHasLocationScope(tenantId, userId)) {
        allowed = (await listLocationsForUser(tenantId, userId)).map((row: any) => String(row.id));
        if (args.locationId && !(await userCanAccessLocation(tenantId, userId, String(args.locationId)))) {
          throw new GraphQLError("ไม่มีสิทธิ์ดูราคาส่งของสาขานี้", { extensions: { code: "FORBIDDEN" } });
        }
      }
      return listProductPriceTiers({
        tenantId,
        productSku: args.productSku ?? null,
        locationId: args.locationId ?? null,
        allowedLocationIds: allowed,
      });
    },
  },
  Mutation: {
    async bmsReplaceProductPriceTiers(_p: unknown, args: { input: ReplaceInput }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const auth = requireAuth(ctx);
        const tenantId = getTenantId(ctx);
        const userId = String(auth.author_id || "");
        const locationId = args.input.locationId ?? null;
        if (await userHasLocationScope(tenantId, userId)) {
          // เหตุผลเดียวกับโปรโมชัน (9.61): บันไดของ "ทั้งร้าน" มีผลกับสาขาที่เขาไม่ได้ดูแลด้วย
          if (!locationId) {
            throw new Error("ผู้ใช้ที่ถูกจำกัดสาขาต้องเลือกสาขาของราคาส่ง (ตั้งราคาทั้งร้านไม่ได้)");
          }
          if (!(await userCanAccessLocation(tenantId, userId, locationId))) {
            throw new Error("ไม่มีสิทธิ์ตั้งราคาส่งให้สาขานี้");
          }
        }
        const tiers = await replaceProductPriceTiers({
          tenantId,
          actorUserId: userId,
          productSku: args.input.productSku,
          locationId,
          tiers: Array.isArray(args.input.tiers) ? args.input.tiers : [],
        });
        await audit(ctx, "product.price_tiers_saved", args.input.productSku, {
          locationId, tierCount: tiers.length,
        });
        return tiers;
      } catch (e: any) {
        throw new GraphQLError(e?.message || "บันทึกราคาส่งไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
