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
  listProductImages,
  upsertProduct,
  setProductActive,
  adjustStock,
  setReorderPoint,
  listLowStock,
  generateInStoreBarcode,
  listPriceTiersForSkus,
} from "@/lib/bms/products";
import { runImport } from "@/lib/bms/productImport";
import { PRODUCT_IMPORT_MAX_ROWS } from "@/lib/bms/productImport.constants";
import { listCategories, createCategory, renameCategory, deleteCategory } from "@/lib/bms/productCategories";
import { listMovements } from "@/lib/bms/movements";
import { listVariantReservations } from "@/lib/bms/stock";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { requireAuth } from "@/lib/auth";
import { listSynonymCandidates, reviewSynonymCandidate } from "@/lib/bms/aiSynonyms";

function toGqlError(err: any): never {
  // ทุก error จาก service ถูกห่อเป็น 400 เหมือนกันหมด ทั้งที่บางอันไม่ใช่ความผิด
  // ของผู้ใช้ (เช่น migration ยังไม่ได้ apply → 42P01 undefined_table) — อย่างน้อย
  // ต้องเหลือร่องรอยจริงไว้ใน log ของ server ไม่งั้นเหลือแค่ 400 เปล่า ๆ ให้ไล่
  if (err?.code || err?.detail || err?.stack) {
    console.error("[bmsProducts] resolver error", {
      code: err?.code ?? null,          // SQLSTATE ถ้ามาจาก pg
      detail: err?.detail ?? null,
      message: err?.message ?? null,
    });
  }
  throw new GraphQLError(err?.message || "operation failed", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

const shapeVariant = (r: {
  location_id?: string;
  location_name?: string;
  branch_code?: string;
  size: string;
  current_stock: number;
  reserved_stock: number;
  quarantine_stock?: number;
  in_transit_qty?: number;
  transfer_lost_qty?: number;
  reorder_point: number;
  price?: number;
  price_override?: number | null;
  base_pack_id?: string | null;
}) => {
  const available = Math.max(0, r.current_stock - r.reserved_stock);
  return {
    locationId: r.location_id ?? null,
    locationName: r.location_name ?? null,
    branchCode: r.branch_code ?? null,
    size: r.size,
    current_stock: r.current_stock,
    reserved_stock: r.reserved_stock,
    quarantine_stock: Number(r.quarantine_stock ?? 0),
    inTransitQty: Number(r.in_transit_qty ?? 0),
    transferLostQty: Number(r.transfer_lost_qty ?? 0),
    reorder_point: r.reorder_point,
    available,
    low: available <= r.reorder_point,
    price: r.price == null ? null : Number(r.price),
    priceOverride: r.price_override == null ? null : Number(r.price_override),
    basePackId: r.base_pack_id ?? null,
  };
};

export const bmsProductsResolvers = {
  Query: {
    async bmsProducts(
      _p: unknown,
      args: { search?: string; category?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      return listProducts(getTenantId(ctx), {
        search: args.search, category: args.category,
        limit: args.limit, offset: args.offset,
      });
    },
    async bmsProductCategories(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      return listCategories(getTenantId(ctx));
    },
    async bmsAiSynonymCandidates(
      _p: unknown,
      args: { status?: string; limit?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      const status = String(args.status || "PENDING").toUpperCase();
      if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
        throw new GraphQLError("สถานะ synonym ไม่ถูกต้อง", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      return listSynonymCandidates(
        getTenantId(ctx),
        status as "PENDING" | "APPROVED" | "REJECTED",
        args.limit ?? 50
      );
    },
    async bmsLowStock(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "product.view");
      const rows = await listLowStock(getTenantId(ctx));
      return rows.map((row) => ({
        ...row,
        locationId: row.location_id,
        locationName: row.location_name,
        branchCode: row.branch_code,
      }));
    },
    async bmsStockMovements(
      _p: unknown,
      args: { sku: string; size?: string | null; limit?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "product.view");
      return listMovements(getTenantId(ctx), args.sku, args.size ?? null, args.limit ?? 50);
    },
    async bmsVariantReservations(
      _p: unknown,
      args: { sku: string; size?: string | null },
      ctx: any
    ) {
      // order.view ไม่ใช่ product.view — คำตอบมีเลขบิล ชื่อและเบอร์ลูกค้าอยู่ในนั้น
      // คนที่ดูแลแค่แคตาล็อกสินค้าไม่ควรอ่านรายชื่อลูกค้าผ่านหน้าสินค้า
      await requirePermission(ctx, "order.view");
      const sku = String(args.sku || "").trim();
      // ไม่ส่ง size = ถามรวมทุกไซซ์ (การ์ดสรุปด้านบนของหน้า Products)
      const size = args.size == null ? null : String(args.size).trim() || null;
      if (!sku) {
        throw new GraphQLError("sku ต้องไม่ว่าง", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      try {
        return await listVariantReservations(getTenantId(ctx), sku, size);
      } catch (err) {
        toGqlError(err);
      }
    },
  },

  Mutation: {
    async bmsReviewAiSynonymCandidate(
      _p: unknown,
      args: { id: string; decision: string; productSku?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "product.edit");
      const decision = String(args.decision || "").toUpperCase();
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new GraphQLError("decision ต้องเป็น APPROVED หรือ REJECTED", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      const auth = requireAuth(ctx);
      try {
        const candidate = await reviewSynonymCandidate(
          getTenantId(ctx),
          args.id,
          decision,
          args.productSku ?? null,
          String(auth.author_id || "") || null
        );
        await audit(ctx, "ai.synonym_review", args.id, {
          decision,
          productSku: decision === "APPROVED" ? args.productSku ?? null : null,
        });
        return candidate;
      } catch (err) {
        toGqlError(err);
      }
    },
    /**
     * ออกบาร์โค้ดช่วงร้านใช้ภายในให้สินค้าที่ไม่มีบาร์โค้ดจากโรงงาน
     *
     * ไม่บันทึกลงสินค้าเอง — คืนเลขให้จอใส่ในฟอร์มแล้วผู้ใช้กดบันทึก เพราะการกดปุ่ม
     * "สร้างเลข" ไม่ควรเป็นการเขียนฐาน: คนกดแล้วเปลี่ยนใจปิดฟอร์มทิ้งเป็นเรื่องปกติ
     * และเลขที่ค้างไว้จะทำให้ลำดับกระโดดโดยไม่มีสินค้าถืออยู่
     */
    async bmsGenerateInStoreBarcode(_p: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        return await generateInStoreBarcode(getTenantId(ctx));
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsUpsertProduct(_p: unknown, args: { input: any }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      const auth = requireAuth(ctx);
      try {
        const p = await upsertProduct(getTenantId(ctx), args.input, auth.author_id);
        await audit(ctx, "product.upsert", args.input?.sku, { name: args.input?.name });
        return p;
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsImportProducts(
      _p: unknown,
      args: { items: any[]; commit?: boolean },
      ctx: any
    ) {
      await requirePermission(ctx, "product.edit");
      const auth = requireAuth(ctx);
      if ((args.items?.length ?? 0) > PRODUCT_IMPORT_MAX_ROWS) {
        throw new GraphQLError(`นำเข้าได้สูงสุดครั้งละ ${PRODUCT_IMPORT_MAX_ROWS} รายการ`, {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }
      try {
        const commit = !!args.commit;
        const result = await runImport(getTenantId(ctx), args.items, { commit, editorId: auth.author_id });
        if (commit) {
          await audit(ctx, "product.import", null, {
            createCount: result.createCount,
            updateCount: result.updateCount,
            errorCount: result.errorCount,
          });
        }
        return result;
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
      const auth = requireAuth(ctx);
      const ok = await setProductActive(getTenantId(ctx), args.sku, args.active, auth.author_id);
      if (ok) await audit(ctx, "product.active", args.sku, { active: args.active });
      return ok;
    },
    async bmsCreateProductCategory(_p: unknown, args: { name: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const c = await createCategory(getTenantId(ctx), args.name);
        await audit(ctx, "product.category.create", c.id, { name: c.name });
        return c;
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsRenameProductCategory(_p: unknown, args: { id: string; name: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      try {
        const c = await renameCategory(getTenantId(ctx), args.id, args.name);
        await audit(ctx, "product.category.rename", c.id, { name: c.name });
        return c;
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsDeleteProductCategory(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "product.edit");
      const ok = await deleteCategory(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "product.category.delete", args.id);
      return ok;
    },
    async bmsAdjustStock(
      _p: unknown,
      args: { sku: string; size: string; delta: number; note?: string; locationId: string },
      ctx: any
    ) {
      await requirePermission(ctx, "stock.adjust");
      const auth = requireAuth(ctx);
      try {
        const row = await adjustStock(
          getTenantId(ctx),
          args.sku,
          args.size,
          args.delta,
          args.note ?? null,
          `admin:${ctx?.admin?.email ?? ctx?.admin?.id ?? "?"}`,
          auth.author_id,
          args.locationId
        );
        await audit(ctx, "stock.adjust", args.sku, {
          locationId: args.locationId, size: args.size, delta: args.delta,
        });
        return shapeVariant(row);
      } catch (err) {
        toGqlError(err);
      }
    },
    async bmsSetReorderPoint(
      _p: unknown,
      args: { sku: string; size: string; reorderPoint: number; locationId: string },
      ctx: any
    ) {
      await requirePermission(ctx, "stock.adjust");
      const auth = requireAuth(ctx);
      try {
        const row = await setReorderPoint(
          getTenantId(ctx), args.sku, args.size, args.reorderPoint, auth.author_id, args.locationId
        );
        return shapeVariant(row);
      } catch (err) {
        toGqlError(err);
      }
    },
  },

  BmsProduct: {
    price: (p: any) => Number(p.price),
    /**
     * ขั้นราคาส่ง (8.1)
     *
     * โหลดต่อสินค้าโดยตั้งใจ ไม่ทำ dataloader: หน้าสินค้าโหลดทีละ 20-50 แถว และ
     * ตารางนี้เล็กมาก (ไม่กี่ขั้นต่อสินค้า) · ถ้าวันหนึ่งหน้ารายการโหลดเป็นพัน
     * ค่อยเปลี่ยนมาใช้ listPriceTiersForSkus ที่ทำไว้แล้ว
     */
    async priceTiers(parent: { tenant_id?: string; sku: string }) {
      if (!parent.tenant_id) return [];
      const map = await listPriceTiersForSkus(parent.tenant_id, [parent.sku]);
      return map.get(parent.sku) ?? [];
    },
    keywords: (p: any) => p.keywords ?? [],
    imageUrl: (p: any) => p.image_url ?? null,
    async images(parent: { tenant_id?: string; sku: string; image_url?: string | null }) {
      const tenantId = parent.tenant_id;
      const gallery = tenantId ? await listProductImages(tenantId, parent.sku) : [];
      const coverUrl = typeof parent.image_url === "string" ? parent.image_url : null;

      if (!coverUrl) return gallery;
      if (gallery.some((img) => img.url === coverUrl)) return gallery;

      const fileIdMatch = coverUrl.match(/\/api\/files\/(\d+)(?:$|[/?#])/);
      const coverId = fileIdMatch ? Number(fileIdMatch[1]) : `cover:${parent.sku}`;

      return [
        { id: coverId, url: coverUrl },
        ...gallery,
      ];
    },
    description: (p: any) => p.description ?? null,
    costPrice: (p: any) => (p.cost_price != null ? Number(p.cost_price) : null),
    weightGrams: (p: any) => (p.weight_grams != null ? Number(p.weight_grams) : null),
    vatCategory: (p: any) => p.vat_category ?? "UNKNOWN",
    category: (p: any) => p.category ?? null,
    brand: (p: any) => p.brand ?? null,
    async variants(parent: { sku: string; tenant_id: string }) {
      const rows = await listVariants(parent.tenant_id, parent.sku);
      return rows.map(shapeVariant);
    },
  },
};
