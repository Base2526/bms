// =============================================================
// GraphQL resolvers — BMS products & inventory (admin panel)
// -------------------------------------------------------------
// ใช้ service เดียวกับที่อื่น (lib/bms/products, lib/bms/movements)
// admin-scope เท่านั้น
// =============================================================

import { GraphQLError } from "graphql/error";
import {
  listProducts,
  listVariants,
  upsertProduct,
  setProductActive,
  adjustStock,
  setReorderPoint,
  listLowStock,
} from "@/lib/bms/products";
import { listMovements } from "@/lib/bms/movements";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

function toGqlError(err: any): never {
  throw new GraphQLError(err?.message || "operation failed", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

const shapeVariant = (r: {
  size: string;
  current_stock: number;
  reserved_stock: number;
  reorder_point: number;
}) => {
  const available = Math.max(0, r.current_stock - r.reserved_stock);
  return {
    size: r.size,
    current_stock: r.current_stock,
    reserved_stock: r.reserved_stock,
    reorder_point: r.reorder_point,
    available,
    low: available <= r.reorder_point,
  };
};

export const bmsProductsResolvers = {
  Query: {
    async bmsProducts(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listProducts(getTenantId(ctx));
    },
    async bmsLowStock(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listLowStock(getTenantId(ctx));
    },
    async bmsStockMovements(
      _p: unknown,
      args: { sku: string; size?: string | null; limit?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      return listMovements(getTenantId(ctx), args.sku, args.size ?? null, args.limit ?? 50);
    },
  },

  Mutation: {
    async bmsUpsertProduct(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const p = await upsertProduct(getTenantId(ctx), args.input);
        await audit(ctx, "product.upsert", args.input?.sku, { name: args.input?.name });
        return p;
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetProductActive(
      _p: unknown,
      args: { sku: string; active: boolean },
      ctx: any
    ) {
      await requirePermission(ctx, "product.delete");
      const ok = await setProductActive(getTenantId(ctx), args.sku, args.active);
      if (ok) await audit(ctx, "product.active", args.sku, { active: args.active });
      return ok;
    },
    async bmsAdjustStock(
      _p: unknown,
      args: { sku: string; size: string; delta: number; note?: string },
      ctx: any
    ) {
      await requirePermission(ctx, "stock.adjust");
      try {
        const row = await adjustStock(
          getTenantId(ctx),
          args.sku,
          args.size,
          args.delta,
          args.note ?? null,
          `admin:${ctx?.admin?.email ?? ctx?.admin?.id ?? "?"}`
        );
        await audit(ctx, "stock.adjust", args.sku, { size: args.size, delta: args.delta });
        return shapeVariant(row);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetReorderPoint(
      _p: unknown,
      args: { sku: string; size: string; reorderPoint: number },
      ctx: any
    ) {
      await requirePermission(ctx, "stock.adjust");
      try {
        const row = await setReorderPoint(getTenantId(ctx), args.sku, args.size, args.reorderPoint);
        return shapeVariant(row);
      } catch (err) {
        toGqlError(err);
      }
    },
  },

  BmsProduct: {
    price: (p: any) => Number(p.price),
    keywords: (p: any) => p.keywords ?? [],
    async variants(parent: { sku: string; tenant_id: string }) {
      const rows = await listVariants(parent.tenant_id, parent.sku);
      return rows.map(shapeVariant);
    },
  },
};
