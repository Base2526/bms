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
} from "@/lib/bms/orders";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

const ORDER_STATUSES = [
  "PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED",
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

export const bmsOrdersResolvers = {
  Query: {
    async bmsOrders(
      _p: unknown,
      args: { status?: OrderStatus; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "order.view");
      const tid = getTenantId(ctx);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const offset = Math.max(Number(args.offset ?? 0), 0);
      const status =
        args.status && ORDER_STATUSES.includes(args.status) ? args.status : null;

      const res = await query(
        `SELECT id, channel, customer_ref, status, total_amount, created_at, updated_at
           FROM bms_orders
          WHERE tenant_id = $4 AND ($1::text IS NULL OR status = $1)
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, offset, tid]
      );
      return res.rows;
    },

    async bmsOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.view");
      const res = await query(
        `SELECT id, channel, customer_ref, status, total_amount, created_at, updated_at
           FROM bms_orders WHERE tenant_id = $2 AND id = $1`,
        [args.id, getTenantId(ctx)]
      );
      return res.rows[0] ?? null;
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
