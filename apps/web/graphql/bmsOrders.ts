// =============================================================
// GraphQL resolvers — BMS orders (admin panel)
// -------------------------------------------------------------
// อ่าน orders + สั่งเปลี่ยนสถานะ (confirm/fulfill/cancel) จากฝั่ง admin
// ใช้ service เดียวกับ REST/chat (lib/bms/orders) เพื่อไม่ให้ตรรกะซ้ำ
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  payOrder,
  packOrder,
  shipOrder,
  completeOrder,
  cancelOrder,
  returnOrder,
} from "@/lib/bms/orders";

const ORDER_STATUSES = ["RESERVED", "CONFIRMED", "FULFILLED", "CANCELLED"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

/** จำกัดเฉพาะ admin — orders เป็นข้อมูลหลังบ้าน */
function requireAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
  return auth;
}

export const bmsOrdersResolvers = {
  Query: {
    async bmsOrders(
      _p: unknown,
      args: { status?: OrderStatus; limit?: number; offset?: number },
      ctx: any
    ) {
      requireAdmin(ctx);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const offset = Math.max(Number(args.offset ?? 0), 0);
      const status =
        args.status && ORDER_STATUSES.includes(args.status) ? args.status : null;

      const res = await query(
        `SELECT id, channel, customer_ref, status, total_amount, created_at, updated_at
           FROM bms_orders
          WHERE ($1::text IS NULL OR status = $1)
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, offset]
      );
      return res.rows;
    },

    async bmsOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      const res = await query(
        `SELECT id, channel, customer_ref, status, total_amount, created_at, updated_at
           FROM bms_orders WHERE id = $1`,
        [args.id]
      );
      return res.rows[0] ?? null;
    },
  },

  Mutation: {
    async bmsPayOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return payOrder(args.id);
    },
    async bmsPackOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return packOrder(args.id);
    },
    async bmsShipOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return shipOrder(args.id);
    },
    async bmsCompleteOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return completeOrder(args.id);
    },
    async bmsCancelOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return cancelOrder(args.id);
    },
    async bmsReturnOrder(_p: unknown, args: { id: string }, ctx: any) {
      requireAdmin(ctx);
      return returnOrder(args.id);
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
