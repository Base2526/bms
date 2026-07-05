// =============================================================
// GraphQL resolvers — BMS products & inventory (admin panel)
// -------------------------------------------------------------
// ใช้ service เดียวกับที่อื่น (lib/bms/products, lib/bms/movements)
// admin-scope เท่านั้น
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
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

function requireAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
  return auth;
}

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
      requireAdmin(ctx);
      return listProducts();
    },
    async bmsLowStock(_p: unknown, _a: unknown, ctx: any) {
      requireAdmin(ctx);
      return listLowStock();
    },
    async bmsStockMovements(
      _p: unknown,
      args: { sku: string; size?: string | null; limit?: number },
      ctx: any
    ) {
      requireAdmin(ctx);
      return listMovements(args.sku, args.size ?? null, args.limit ?? 50);
    },
  },

  Mutation: {
    async bmsUpsertProduct(_p: unknown, args: { input: any }, ctx: any) {
      requireAdmin(ctx);
      try {
        return await upsertProduct(args.input);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetProductActive(
      _p: unknown,
      args: { sku: string; active: boolean },
      ctx: any
    ) {
      requireAdmin(ctx);
      return setProductActive(args.sku, args.active);
    },
    async bmsAdjustStock(
      _p: unknown,
      args: { sku: string; size: string; delta: number; note?: string },
      ctx: any
    ) {
      const auth = requireAdmin(ctx);
      try {
        const row = await adjustStock(
          args.sku,
          args.size,
          args.delta,
          args.note ?? null,
          `admin:${auth.author_id ?? "?"}`
        );
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
      requireAdmin(ctx);
      try {
        const row = await setReorderPoint(args.sku, args.size, args.reorderPoint);
        return shapeVariant(row);
      } catch (err) {
        toGqlError(err);
      }
    },
  },

  BmsProduct: {
    price: (p: any) => Number(p.price),
    keywords: (p: any) => p.keywords ?? [],
    async variants(parent: { sku: string }) {
      const rows = await listVariants(parent.sku);
      return rows.map(shapeVariant);
    },
  },
};
