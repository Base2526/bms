// =============================================================
// GraphQL resolvers — BMS Purchase Management (admin panel)
// -------------------------------------------------------------
// PO ต่อ supplier: สร้าง / รับของ (บางส่วน-ครบ) / ยกเลิก
// ใช้ service เดียวกับ REST (lib/bms/purchase) — ตรรกะไม่ซ้ำ
// permission enforce ทุก field + audit ทุก mutation ที่สำเร็จ
// =============================================================

import { query } from "@/lib/db";
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  listSuppliers,
  listSupplierProducts,
  type PoItemInput,
  type ReceiveInput,
} from "@/lib/bms/purchase";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { requireAuth } from "@/lib/auth";

const toISO = (d: any) => (d instanceof Date ? d.toISOString() : String(d));

export const bmsPurchaseResolvers = {
  Query: {
    async bmsPurchaseOrders(
      _p: unknown,
      args: { search?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "purchase.view");
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const offset = Math.max(Number(args.offset ?? 0), 0);
      return listPurchaseOrders(getTenantId(ctx), args.search ?? "", limit, offset);
    },

    async bmsPurchaseOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "purchase.view");
      return getPurchaseOrder(getTenantId(ctx), args.id);
    },

    async bmsSuppliers(_p: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "purchase.view");
      return listSuppliers(getTenantId(ctx));
    },

    async bmsSupplierProducts(
      _p: unknown,
      args: { supplierId: string; search?: string | null; limit?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "purchase.view");
      return listSupplierProducts(
        getTenantId(ctx), args.supplierId, args.search ?? "",
        Math.min(Math.max(Number(args.limit ?? 200), 1), 500)
      );
    },
  },

  Mutation: {
    async bmsCreatePurchaseOrder(
      _p: unknown,
      args: {
        supplierId?: string | null;
        supplierName?: string | null;
        note?: string | null;
        items: PoItemInput[];
      },
      ctx: any
    ) {
      await requirePermission(ctx, "purchase.edit");
      const result = await createPurchaseOrder({
        tenantId: getTenantId(ctx),
        supplierId: args.supplierId ?? null,
        supplierName: args.supplierName ?? null,
        note: args.note ?? null,
        items: Array.isArray(args.items) ? args.items : [],
      });

      if (result.status === "CREATED") {
        await audit(ctx, "purchase.create", result.poId, { total: result.total });
        return { status: "CREATED", poId: result.poId, message: "สร้างใบสั่งซื้อแล้ว" };
      }
      if (result.status === "NOT_FOUND") {
        return { status: "NOT_FOUND", poId: null, message: `ไม่พบสินค้า ${result.sku}` };
      }
      if (result.status === "SUPPLIER_NOT_FOUND") {
        return { status: result.status, poId: null, message: "ไม่พบผู้ขายที่เลือก" };
      }
      if (result.status === "SUPPLIER_REQUIRED") {
        return { status: result.status, poId: null, message: "ต้องระบุผู้ขายก่อนบันทึก SKU ผู้ขาย" };
      }
      if (result.status === "SUPPLIER_SKU_CONFLICT") {
        return {
          status: result.status,
          poId: null,
          message: `SKU ผู้ขาย ${result.supplierSku} ถูกผูกกับ ${result.sku} / ${result.size} แล้ว`,
        };
      }
      if (result.status === "INVALID_INPUT") {
        return { status: result.status, poId: null, message: "ข้อมูลสินค้าในใบสั่งซื้อไม่ถูกต้อง" };
      }
      return { status: "EMPTY", poId: null, message: "ไม่มีรายการสินค้า" };
    },

    async bmsReceivePurchaseOrder(
      _p: unknown,
      args: { id: string; items: ReceiveInput[] },
      ctx: any
    ) {
      await requirePermission(ctx, "purchase.receive");
      const auth = requireAuth(ctx);
      const result = await receivePurchaseOrder(
        getTenantId(ctx),
        args.id,
        Array.isArray(args.items) ? args.items : [],
        `admin:${ctx?.admin?.email ?? ctx?.admin?.id ?? "?"}`,
        auth.author_id,
        {
          audit: {
            actor: String(ctx?.admin?.email ?? ctx?.admin?.id ?? auth.author_id),
            action: "purchase.receive",
            meta: { surface: "admin" },
          },
        }
      );

      if (result.status === "RECEIVED" || result.status === "PARTIAL") {
        return {
          status: result.status,
          poId: result.poId,
          message: result.status === "RECEIVED" ? "รับของครบแล้ว" : "รับของบางส่วนแล้ว",
        };
      }
      const msg: Record<string, string> = {
        PO_NOT_FOUND: "ไม่พบใบสั่งซื้อ",
        LOCATION_NOT_FOUND: "ไม่พบสาขาที่รับสินค้า",
        INVALID_INPUT: "รายการรับสินค้าไม่ถูกต้อง",
        INVALID_STATE: "สถานะไม่อนุญาตให้รับของ",
        LINE_NOT_FOUND: "ไม่พบรายการสินค้าในใบสั่งซื้อ",
        OVER_RECEIVE: "รับเกินจำนวนที่สั่ง",
        IDEMPOTENCY_CONFLICT: "คีย์รายการซ้ำถูกใช้กับข้อมูลอื่น",
        EMPTY: "ไม่มีรายการรับของ",
      };
      return { status: result.status, poId: args.id, message: msg[result.status] ?? "ทำรายการไม่ได้" };
    },

    async bmsCancelPurchaseOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "purchase.cancel");
      const auth = requireAuth(ctx);
      const ok = await cancelPurchaseOrder(getTenantId(ctx), args.id, auth.author_id);
      if (ok) await audit(ctx, "purchase.cancel", args.id);
      return ok;
    },
  },

  // field resolvers — normalize + lazy-load items
  BmsPurchaseOrder: {
    total: (p: any) => Number(p.total ?? p.total_amount ?? 0),
    qtyOrdered: (p: any) =>
      p.qtyOrdered ?? (p.items ? p.items.reduce((n: number, i: any) => n + i.qtyOrdered, 0) : 0),
    qtyReceived: (p: any) =>
      p.qtyReceived ?? (p.items ? p.items.reduce((n: number, i: any) => n + i.qtyReceived, 0) : 0),
    createdAt: (p: any) => toISO(p.createdAt ?? p.created_at),
    updatedAt: (p: any) => toISO(p.updatedAt ?? p.updated_at),
    async items(p: any, _a: unknown, ctx: any) {
      if (p.items) return p.items;
      const res = await query(
        `SELECT product_sku, size, supplier_sku, supplier_product_name,
                qty_ordered, qty_received, unit_cost
           FROM bms_purchase_order_items WHERE tenant_id = $1 AND po_id = $2
          ORDER BY product_sku, size`,
        [getTenantId(ctx), p.id]
      );
      return res.rows.map((r: any) => ({
        sku: r.product_sku, size: r.size,
        supplierSku: r.supplier_sku,
        supplierProductName: r.supplier_product_name,
        qtyOrdered: r.qty_ordered, qtyReceived: r.qty_received,
        unitCost: Number(r.unit_cost),
      }));
    },
  },
};
