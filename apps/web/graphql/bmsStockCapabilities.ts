import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import {
  isCapabilityEnabledInTx,
  listStoreCapabilities,
  resetStoreCapability,
  upsertStoreCapability,
} from "@/lib/bms/storeCapabilities";
import { query } from "@/lib/db";
import {
  getProductStockPolicy,
  upsertProductStockPolicy,
  type ProductStockPolicy,
} from "@/lib/bms/productStockPolicies";
import {
  listProductModifiers,
  listProductRecipes,
  upsertProductModifier,
  upsertProductRecipe,
} from "@/lib/bms/productRecipes";
import {
  listKitchenTickets,
  updateKitchenTicketStatus,
  updateKitchenTicketsStatus,
} from "@/lib/bms/kitchen";
import {
  clearKitchenStationSla,
  listKitchenStationSlas,
  upsertKitchenStationSla,
} from "@/lib/bms/kitchenSla";
import { dropKitchenCancelledLineInTx } from "@/lib/bms/restaurantPos";
import { listInventoryWastage, recordInventoryWastage } from "@/lib/bms/wastage";
import { getProductReadiness } from "@/lib/bms/productConfiguration";

function tenantAdminId(ctx: any): string {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
  return String(auth.author_id);
}

function badInput(error: unknown, fallback: string): never {
  throw new GraphQLError(error instanceof Error ? error.message : fallback, {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

export const bmsStockCapabilityResolvers = {
  Query: {
    async bmsStoreCapabilities(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listStoreCapabilities(getTenantId(ctx));
    },
    /**
     * ใช้ตัดสินว่าจะขึ้นเมนู "กระดานครัว" ใน sidebar ไหม — ยิงทุกครั้งที่เปิดหน้าหลังบ้าน
     * จึงต้องเป็น query เดี่ยวที่เบา ไม่ใช่ `bmsStoreCapabilities` ทั้งชุดซึ่งรัน UNION
     * ตรวจ "ตั้งค่าไปแล้วหรือยัง" ของทั้ง 13 ความสามารถ
     *
     * ล้มแล้วตอบ false ไม่ throw: เมนูที่หายไปคือความไม่สะดวก แต่ sidebar ที่พังทั้งอัน
     * (เช่นฐานที่ยังไม่ apply 9.40) แปลว่าเปิดหลังบ้านไม่ได้เลยสักหน้า
     */
    async bmsKitchenBoardEnabled(_p: unknown, _a: unknown, ctx: any) {
      tenantAdminId(ctx);
      try {
        return await isCapabilityEnabledInTx({ query }, getTenantId(ctx), "KITCHEN_WORKFLOW");
      } catch {
        return false;
      }
    },
    /** Lightweight sidebar checks; keep the full 13-capability UNION on Stock Models only. */
    async bmsWastageEnabled(_p: unknown, _a: unknown, ctx: any) {
      tenantAdminId(ctx);
      try {
        return await isCapabilityEnabledInTx({ query }, getTenantId(ctx), "WASTAGE");
      } catch {
        return false;
      }
    },
    async bmsPackToolsConfigured(_p: unknown, _a: unknown, ctx: any) {
      tenantAdminId(ctx);
      try {
        const result = await query<{ configured: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM bms_product_packs
              WHERE tenant_id = $1
                AND active
                AND (NOT is_base OR barcode IS NOT NULL)
             UNION ALL
             SELECT 1
               FROM bms_products
              WHERE tenant_id = $1
                AND barcode IS NOT NULL
             UNION ALL
             SELECT 1
               FROM bms_product_stock_policies
              WHERE tenant_id = $1
                AND stock_policy IN ('PACK', 'BUNDLE')
           ) AS configured`,
          [getTenantId(ctx)]
        );
        return result.rows[0]?.configured === true;
      } catch {
        return false;
      }
    },
    async bmsProductStockPolicy(_p: unknown, args: { productSku: string }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return getProductStockPolicy(getTenantId(ctx), args.productSku);
    },
    async bmsProductReadiness(_p: unknown, args: { productSku: string }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return getProductReadiness(getTenantId(ctx), args.productSku);
    },
    async bmsProductRecipes(_p: unknown, args: { productSku: string; size?: string | null }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listProductRecipes(getTenantId(ctx), args.productSku, args.size);
    },
    async bmsProductModifiers(_p: unknown, args: { productSku: string; size?: string | null }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listProductModifiers(getTenantId(ctx), args.productSku, args.size);
    },
    async bmsKitchenTickets(_p: unknown, args: { status?: string | null; limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "order.view");
      return listKitchenTickets(getTenantId(ctx), args.status, args.limit ?? 100);
    },
    async bmsKitchenStationSlas(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listKitchenStationSlas(getTenantId(ctx));
    },
    async bmsInventoryWastage(_p: unknown, args: { limit?: number | null }, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listInventoryWastage(getTenantId(ctx), args.limit ?? 100);
    },
  },
  Mutation: {
    async bmsUpsertStoreCapability(
      _p: unknown,
      args: { capability: string; enabled: boolean; config?: unknown },
      ctx: any
    ) {
      // ⚠️ สวิตช์ความสามารถเปลี่ยนพฤติกรรมการขายทั้งร้าน (ปิดชั่งขาย/เปิดสูตร) จึงต้องใช้
      // สิทธิ์เดียวกับที่หน้าจอซ่อนปุ่มไว้ — การซ่อนปุ่มฝั่ง client ไม่ใช่ด่าน
      await requirePermission(ctx, "product.edit");
      const actorId = tenantAdminId(ctx);
      try {
        const result = await upsertStoreCapability(getTenantId(ctx), args, actorId);
        await audit(ctx, "store.capability_upsert", result.capability, { enabled: result.enabled });
        return result;
      } catch (error) {
        badInput(error, "บันทึกความสามารถร้านไม่สำเร็จ");
      }
    },
    async bmsResetStoreCapability(_p: unknown, args: { capability: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      const actorId = tenantAdminId(ctx);
      try {
        const result = await resetStoreCapability(getTenantId(ctx), args.capability, actorId);
        await audit(ctx, "store.capability_reset", result.capability, {});
        return result;
      } catch (error) {
        badInput(error, "คืนค่า preset ไม่สำเร็จ");
      }
    },
    async bmsUpsertProductStockPolicy(
      _p: unknown,
      args: { input: Partial<ProductStockPolicy> & { productSku: string } },
      ctx: any
    ) {
      await requirePermission(ctx, "product.edit");
      try {
        const result = await upsertProductStockPolicy(
          getTenantId(ctx), args.input, String(requireAuth(ctx).author_id)
        );
        await audit(ctx, "product.stock_policy_upsert", result.productSku, { stockPolicy: result.stockPolicy });
        return result;
      } catch (error) {
        badInput(error, "บันทึกนโยบาย Stock ไม่สำเร็จ");
      }
    },
    async bmsUpsertProductRecipe(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const result = await upsertProductRecipe(
          getTenantId(ctx), args.input, String(requireAuth(ctx).author_id)
        );
        await audit(ctx, "product.recipe_upsert", result.id, {
          sku: result.productSku, size: result.size, version: result.version,
        });
        return result;
      } catch (error) {
        badInput(error, "บันทึกสูตรไม่สำเร็จ");
      }
    },
    async bmsUpsertProductModifier(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const result = await upsertProductModifier(
          getTenantId(ctx), args.input, String(requireAuth(ctx).author_id)
        );
        await audit(ctx, "product.modifier_upsert", result.id, {
          sku: result.productSku, size: result.size, code: result.code,
        });
        return result;
      } catch (error) {
        badInput(error, "บันทึก Modifier ไม่สำเร็จ");
      }
    },
    async bmsUpsertKitchenStationSla(
      _p: unknown,
      args: { station: string; warnMinutes: number; lateMinutes: number },
      ctx: any
    ) {
      // สิทธิ์เดียวกับสวิตช์ความสามารถและรูปแบบสต็อก — เป็นค่าตั้งของหน้า /admin/stock-models
      await requirePermission(ctx, "product.edit");
      try {
        const saved = await upsertKitchenStationSla(getTenantId(ctx), args, String(requireAuth(ctx).author_id));
        return { ...saved, configured: true };
      } catch (error) {
        badInput(error, "บันทึกเกณฑ์เวลาของสถานีไม่สำเร็จ");
      }
    },
    async bmsClearKitchenStationSla(_p: unknown, args: { station: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        return await clearKitchenStationSla(getTenantId(ctx), args.station, String(requireAuth(ctx).author_id));
      } catch (error) {
        badInput(error, "ล้างเกณฑ์เวลาของสถานีไม่สำเร็จ");
      }
    },
    // กระดานหลังบ้านรวมใบเหมือนจอครัวของเครื่องขาย ปุ่มเดียวจึงขยับหลายตั๋ว —
    // ใช้ service ตัวเดียวกัน (ทรานแซกชันเดียว ทั้งหมดหรือไม่เลื่อนเลย)
    async bmsUpdateKitchenTicketsStatus(_p: unknown, args: { ids: string[]; status: string }, ctx: any) {
      await requirePermission(ctx, "restaurant.kitchen.update");
      try {
        return await updateKitchenTicketsStatus({
          tenantId: getTenantId(ctx),
          ticketIds: args.ids,
          status: args.status,
          actorUserId: String(requireAuth(ctx).author_id),
          onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
        });
      } catch (error) {
        badInput(error, "อัปเดต Kitchen ticket ไม่สำเร็จ");
      }
    },
    async bmsUpdateKitchenTicketStatus(_p: unknown, args: { id: string; status: string }, ctx: any) {
      await requirePermission(ctx, "restaurant.kitchen.update");
      try {
        return await updateKitchenTicketStatus({
          tenantId: getTenantId(ctx),
          ticketId: args.id,
          status: args.status,
          actorUserId: String(requireAuth(ctx).author_id),
          // กระดานหลังบ้านต้องให้ผลเดียวกับเครื่องขาย: ยกเลิกแล้วบรรทัดหลุดจากยอด
          onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
        });
      } catch (error) {
        badInput(error, "อัปเดต Kitchen ticket ไม่สำเร็จ");
      }
    },
    async bmsRecordInventoryWastage(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "stock.adjust");
      try {
        return await recordInventoryWastage({
          ...args.input,
          tenantId: getTenantId(ctx),
          actorUserId: String(requireAuth(ctx).author_id),
        });
      } catch (error) {
        badInput(error, "บันทึกของเสียไม่สำเร็จ");
      }
    },
  },
};
