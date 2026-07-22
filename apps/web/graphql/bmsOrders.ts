// =============================================================
// GraphQL resolvers — BMS orders (admin panel)
// -------------------------------------------------------------
// อ่าน orders + สั่งเปลี่ยนสถานะ (confirm/fulfill/cancel) จากฝั่ง admin
// ใช้ service เดียวกับ REST/chat (lib/bms/orders) เพื่อไม่ให้ตรรกะซ้ำ
// =============================================================

import { query } from "@/lib/db";
import {
  payOrder,
  packOrder,
  shipOrder,
  completeOrder,
  cancelOrder,
  returnOrder,
  getOrderJourney,
  reorderFromOrder,
  createOrder,
} from "@/lib/bms/orders";
import { MARKETPLACE_CHANNELS } from "@/lib/bms/shipping";
import { generateInvoice } from "@/lib/bms/documents";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

const ORDER_STATUSES = [
  "PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED",
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

const VALID_ORDER_CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"] as const;

export const bmsOrdersResolvers = {
  Query: {
    async bmsOrders(
      _p: unknown,
      args: { search?: string; status?: OrderStatus; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "order.view");
      const tid = getTenantId(ctx);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const offset = Math.max(Number(args.offset ?? 0), 0);
      const search = args.search?.trim() || null;
      const status =
        args.status && ORDER_STATUSES.includes(args.status) ? args.status : null;

      const res = await query(
        `SELECT id, channel, customer_ref, customer_id, status, total_amount, created_at, updated_at
           FROM bms_orders
          WHERE tenant_id = $4
            AND ($1::text IS NULL OR status = $1)
            AND (
              $5::text IS NULL
              OR id::text ILIKE '%' || $5 || '%'
              OR channel ILIKE '%' || $5 || '%'
              OR COALESCE(customer_ref, '') ILIKE '%' || $5 || '%'
            )
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, offset, tid, search]
      );
      return res.rows;
    },

    async bmsOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.view");
      const res = await query(
        `SELECT id, channel, customer_ref, customer_id, status, total_amount, created_at, updated_at
           FROM bms_orders WHERE tenant_id = $2 AND id = $1`,
        [args.id, getTenantId(ctx)]
      );
      return res.rows[0] ?? null;
    },

    async bmsOrderJourney(_p: unknown, args: { orderId: string }, ctx: any) {
      await requirePermission(ctx, "order.view");
      return getOrderJourney(getTenantId(ctx), args.orderId);
    },

    async bmsGenerateInvoice(_p: unknown, args: { orderId: string }, ctx: any) {
      await requirePermission(ctx, "order.view");
      return generateInvoice(getTenantId(ctx), args.orderId);
    },
  },

  Mutation: {
    async bmsPayOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.pay");
      const ok = await payOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.pay", args.id);
      return ok;
    },
    async bmsPackOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.ship");
      const ok = await packOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.pack", args.id);
      return ok;
    },
    async bmsShipOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.ship");
      const ok = await shipOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.ship", args.id);
      return ok;
    },
    async bmsCompleteOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.pay");
      const ok = await completeOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.complete", args.id);
      return ok;
    },
    async bmsCancelOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.cancel");
      const ok = await cancelOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.cancel", args.id);
      return ok;
    },
    async bmsReturnOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.return");
      const ok = await returnOrder(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "order.return", args.id);
      return ok;
    },
    async bmsReorderFromOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.create");
      const r = await reorderFromOrder(getTenantId(ctx), args.id, ctx?.admin?.id ?? null);
      if (r.status === "CREATED") {
        await audit(ctx, "order.reorder", r.orderId, { sourceOrderId: args.id });
        return { status: r.status, orderId: r.orderId, total: r.total, message: `สร้างออร์เดอร์ใหม่แล้ว ยอดรวม ${r.total.toLocaleString()} ฿` };
      }
      const messages: Record<string, string> = {
        SOURCE_NOT_FOUND: "ไม่พบออร์เดอร์ต้นทาง",
        EMPTY: "ออร์เดอร์ต้นทางไม่มีรายการสินค้า",
        NOT_FOUND: `ไม่พบสินค้า ${("sku" in r) ? r.sku : ""} ในระบบ (อาจถูกลบไปแล้ว)`,
        INSUFFICIENT: (r.status === "INSUFFICIENT") ? `${r.sku} (${r.size}) เหลือ ${r.available} ไม่พอสั่ง ${r.requested}` : "สต็อกไม่พอ",
      };
      return { status: r.status, orderId: null, total: null, message: messages[r.status] ?? "สร้างออร์เดอร์ซ้ำไม่สำเร็จ" };
    },
    async bmsCreateOrder(
      _p: unknown,
      args: { channel?: string | null; customerRef?: string | null; items: { sku: string; size: string; qty: number }[] },
      ctx: any
    ) {
      await requirePermission(ctx, "order.create");
      const channel = (VALID_ORDER_CHANNELS as readonly string[]).includes(args.channel ?? "")
        ? (args.channel as (typeof VALID_ORDER_CHANNELS)[number])
        : "web";
      const r = await createOrder({
        tenantId: getTenantId(ctx),
        channel,
        customerRef: args.customerRef ?? null,
        items: args.items ?? [],
        editorId: ctx?.admin?.id ?? null,
      });
      if (r.status === "CREATED") {
        await audit(ctx, "order.create", r.orderId, { itemCount: (args.items ?? []).length, total: r.total });
        return { status: r.status, orderId: r.orderId, total: r.total, message: `สร้างออร์เดอร์แล้ว ยอดรวม ${r.total.toLocaleString()} ฿` };
      }
      const messages: Record<string, string> = {
        EMPTY: "ไม่มีรายการสินค้า",
        NOT_FOUND: `ไม่พบสินค้า ${("sku" in r) ? r.sku : ""} ในระบบ (อาจถูกลบไปแล้ว)`,
        INSUFFICIENT: (r.status === "INSUFFICIENT") ? `${r.sku} (${r.size}) เหลือ ${r.available} ไม่พอสั่ง ${r.requested}` : "สต็อกไม่พอ",
      };
      return { status: r.status, orderId: null, total: null, message: messages[r.status] ?? "สร้างออร์เดอร์ไม่สำเร็จ" };
    },
  },

  // field resolver: ดึงรายการสินค้าในออร์เดอร์
  BmsOrder: {
    async items(parent: { id: string }) {
      const res = await query(
        `SELECT product_sku, size, qty, unit_price
           FROM bms_order_items WHERE order_id = $1
          ORDER BY id`,
        [parent.id]
      );
      return res.rows;
    },
    // มาร์เก็ตเพลส (lazada/shopee/tiktok) = ที่อยู่อยู่ฝั่งแพลตฟอร์ม ไม่ต้องเช็ก — ช่องทางอื่นต้องมีที่อยู่จัดส่งก่อนถึงจัดส่งได้
    async hasShippingAddress(parent: { channel: string; customer_id: string | null }, _args: unknown, ctx: any) {
      if (MARKETPLACE_CHANNELS.has(parent.channel)) return true;
      if (!parent.customer_id) return false;
      const res = await query(
        `SELECT 1 FROM bms_customer_addresses
          WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping' LIMIT 1`,
        [getTenantId(ctx), parent.customer_id]
      );
      return (res.rowCount ?? 0) > 0;
    },
    // normalize ให้ตรง schema (String! สำหรับ timestamps, Float สำหรับ numeric)
    total_amount: (p: any) => Number(p.total_amount),
    created_at: (p: any) =>
      p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
    updated_at: (p: any) =>
      p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
  },

  BmsOrderItem: {
    unit_price: (p: any) => Number(p.unit_price),
  },
};
