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
import { listOrderDiscounts } from "@/lib/bms/membership";
import { generateInvoice } from "@/lib/bms/documents";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";
import { listLocationsForUser, userCanAccessLocation } from "@/lib/bms/locations";
import { requireAuth } from "@/lib/auth";
import { GraphQLError } from "graphql/error";

const ORDER_STATUSES = [
  "PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED",
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

const VALID_ORDER_CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"] as const;

async function assertOrderBranchAccess(ctx: any, tenantId: string, orderId: string): Promise<void> {
  const userId = String(requireAuth(ctx).author_id || "");
  if (!userId) return;
  const res = await query<{ allowed: boolean }>(
    `SELECT (
        NOT EXISTS (
          SELECT 1 FROM bms_user_allowed_locations al
           WHERE al.tenant_id = $1 AND al.user_id = $2
        )
        OR EXISTS (
          SELECT 1
            FROM bms_orders o
            JOIN bms_user_allowed_locations al
              ON al.tenant_id = o.tenant_id
             AND al.user_id = $2
             AND al.location_id = o.location_id
           WHERE o.tenant_id = $1 AND o.id = $3
        )
      ) AS allowed`,
    [tenantId, userId, orderId]
  );
  if (!res.rows[0]?.allowed) {
    throw new GraphQLError("ไม่มีสิทธิ์จัดการออเดอร์ของสาขานี้", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
}

async function resolveWritableLocationId(tenantId: string, userId: string, requestedLocationId: string | null): Promise<string | null> {
  const allowed = await userCanAccessLocation(tenantId, userId, requestedLocationId);
  if (allowed) return requestedLocationId;
  if (!requestedLocationId) {
    const allowedLocations = await listLocationsForUser(tenantId, userId);
    if (allowedLocations.length === 1) return allowedLocations[0].id;
    throw new GraphQLError("ต้องเลือกสาขาก่อนสร้างออเดอร์", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
  throw new GraphQLError("ไม่มีสิทธิ์สร้างออเดอร์ให้สาขานี้", {
    extensions: { code: "FORBIDDEN", http: { status: 403 } },
  });
}

export const bmsOrdersResolvers = {
  Query: {
    async bmsOrders(
      _p: unknown,
      args: { search?: string; status?: OrderStatus; limit?: number; offset?: number; locationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "order.view");
      const tid = getTenantId(ctx);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const offset = Math.max(Number(args.offset ?? 0), 0);
      const search = args.search?.trim() || null;
      const status =
        args.status && ORDER_STATUSES.includes(args.status) ? args.status : null;
      const locationId = args.locationId?.trim() || null;
      const userId = String(requireAuth(ctx).author_id || "");

      const res = await query(
        `SELECT o.id, o.channel, o.customer_ref, o.customer_id, o.status, o.total_amount, o.discount_amount, o.shipping_fee,
                (o.total_amount + o.shipping_fee) AS amount_due,
                COALESCE(d.deposit_paid, 0) AS deposit_paid,
                CASE WHEN d.id IS NULL THEN 0 ELSE GREATEST(d.total_amount - d.deposit_paid, 0) END AS deposit_balance_due,
                d.status AS deposit_status,
                o.coupon_code, o.preferred_carrier, o.fulfillment_type, o.promised_at, o.location_id,
                loc.name AS location_name, loc.branch_code,
                pd.name AS pos_device_name, pd.registered_pos_no,
                o.pos_shift_id, o.created_at, o.updated_at
           FROM bms_orders o
           LEFT JOIN bms_pos_deposits d
             ON d.tenant_id = o.tenant_id AND d.order_id = o.id
           LEFT JOIN bms_locations loc ON loc.tenant_id = o.tenant_id AND loc.id = o.location_id
           LEFT JOIN bms_pos_devices pd ON pd.tenant_id = o.tenant_id AND pd.id = o.pos_device_id
          WHERE o.tenant_id = $4
            AND ($1::text IS NULL OR o.status = $1)
            AND ($6::uuid IS NULL OR o.location_id = $6)
            AND (
              NOT EXISTS (
                SELECT 1 FROM bms_user_allowed_locations al
                 WHERE al.tenant_id = o.tenant_id AND al.user_id = $7
              )
              OR EXISTS (
                SELECT 1 FROM bms_user_allowed_locations al
                 WHERE al.tenant_id = o.tenant_id
                   AND al.user_id = $7
                   AND al.location_id = o.location_id
              )
            )
            AND (
              $5::text IS NULL
              OR o.id::text ILIKE '%' || $5 || '%'
              OR o.channel ILIKE '%' || $5 || '%'
              OR COALESCE(o.customer_ref, '') ILIKE '%' || $5 || '%'
              OR COALESCE(loc.name, '') ILIKE '%' || $5 || '%'
              OR COALESCE(loc.branch_code, '') ILIKE '%' || $5 || '%'
            )
          ORDER BY o.created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, offset, tid, search, locationId, userId]
      );
      return res.rows;
    },

    async bmsOrderLocations(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "order.view");
      const tenantId = getTenantId(ctx);
      const userId = String(requireAuth(ctx).author_id || "");
      return listLocationsForUser(tenantId, userId);
    },

    async bmsOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.view");
      const tenantId = getTenantId(ctx);
      const userId = String(requireAuth(ctx).author_id || "");
      const res = await query(
        `SELECT o.id, o.channel, o.customer_ref, o.customer_id, o.status, o.total_amount, o.discount_amount, o.shipping_fee,
                (o.total_amount + o.shipping_fee) AS amount_due,
                COALESCE(d.deposit_paid, 0) AS deposit_paid,
                CASE WHEN d.id IS NULL THEN 0 ELSE GREATEST(d.total_amount - d.deposit_paid, 0) END AS deposit_balance_due,
                d.status AS deposit_status,
                o.coupon_code, o.preferred_carrier, o.fulfillment_type, o.promised_at, o.location_id,
                loc.name AS location_name, loc.branch_code,
                pd.name AS pos_device_name, pd.registered_pos_no,
                o.pos_shift_id, o.created_at, o.updated_at
           FROM bms_orders o
           LEFT JOIN bms_pos_deposits d
             ON d.tenant_id = o.tenant_id AND d.order_id = o.id
           LEFT JOIN bms_locations loc ON loc.tenant_id = o.tenant_id AND loc.id = o.location_id
           LEFT JOIN bms_pos_devices pd ON pd.tenant_id = o.tenant_id AND pd.id = o.pos_device_id
          WHERE o.tenant_id = $2 AND o.id = $1
            AND (
              NOT EXISTS (
                SELECT 1 FROM bms_user_allowed_locations al
                 WHERE al.tenant_id = o.tenant_id AND al.user_id = $3
              )
              OR EXISTS (
                SELECT 1 FROM bms_user_allowed_locations al
                 WHERE al.tenant_id = o.tenant_id
                   AND al.user_id = $3
                   AND al.location_id = o.location_id
              )
            )`,
        [args.id, tenantId, userId]
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
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await payOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.pay", args.id);
      return ok;
    },
    async bmsPackOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.ship");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await packOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.pack", args.id);
      return ok;
    },
    async bmsShipOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.ship");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await shipOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.ship", args.id);
      return ok;
    },
    async bmsCompleteOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.pay");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await completeOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.complete", args.id);
      return ok;
    },
    async bmsCancelOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.cancel");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await cancelOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.cancel", args.id);
      return ok;
    },
    async bmsReturnOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.return");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const ok = await returnOrder(tenantId, args.id);
      if (ok) await audit(ctx, "order.return", args.id);
      return ok;
    },
    async bmsReorderFromOrder(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "order.create");
      const tenantId = getTenantId(ctx);
      await assertOrderBranchAccess(ctx, tenantId, args.id);
      const r = await reorderFromOrder(tenantId, args.id, ctx?.admin?.id ?? null);
      if (r.status === "CREATED") {
        await audit(ctx, "order.reorder", r.orderId, { sourceOrderId: args.id });
        return { status: r.status, orderId: r.orderId, total: r.total, message: `สร้างออร์เดอร์ใหม่แล้ว ยอดรวม ${r.total.toLocaleString()} ฿` };
      }
      const messages: Record<string, string> = {
        SOURCE_NOT_FOUND: "ไม่พบออร์เดอร์ต้นทาง",
        EMPTY: "ออร์เดอร์ต้นทางไม่มีรายการสินค้า",
        INVALID_ITEM: r.status === "INVALID_ITEM" ? r.reason : "รายการสินค้าไม่ถูกต้อง",
        NOT_FOUND: `ไม่พบสินค้า ${("sku" in r) ? r.sku : ""} ในระบบ (อาจถูกลบไปแล้ว)`,
        INSUFFICIENT: (r.status === "INSUFFICIENT") ? `${r.sku} (${r.size}) เหลือ ${r.available} ไม่พอสั่ง ${r.requested}` : "สต็อกไม่พอ",
        PHARMACY_POLICY_UNKNOWN: "สินค้านี้ยังไม่มี Product Policy ที่เภสัชกรอนุมัติ",
        PHARMACY_SAFETY_CHECK_REQUIRED: "สินค้านี้ต้องผ่านการตรวจข้อมูลความปลอดภัยก่อน",
        PHARMACY_REVIEW_REQUIRED: "สินค้านี้ต้องผ่านการตรวจโดยเภสัชกรก่อน",
        PHARMACY_PRESCRIPTION_REQUIRED: "สินค้านี้ต้องมีใบสั่งและผ่านการตรวจโดยเภสัชกร",
        PHARMACY_ONLINE_SALE_PROHIBITED: "สินค้านี้ไม่อนุญาตให้สร้างออร์เดอร์ออนไลน์",
        PHARMACY_QUANTITY_LIMIT_EXCEEDED: "จำนวนเกินข้อกำหนดของ Product Policy",
      };
      return { status: r.status, orderId: null, total: null, message: messages[r.status] ?? "สร้างออร์เดอร์ซ้ำไม่สำเร็จ" };
    },
    async bmsCreateOrder(
      _p: unknown,
      args: { channel?: string | null; customerRef?: string | null; items: { sku: string; size: string; qty: number }[]; couponCode?: string | null; preferredCarrier?: string | null; locationId?: string | null },
      ctx: any
    ) {
      await requirePermission(ctx, "order.create");
      const tenantId = getTenantId(ctx);
      const userId = String(requireAuth(ctx).author_id || "");
      const locationId = await resolveWritableLocationId(tenantId, userId, args.locationId?.trim() || null);
      const channel = (VALID_ORDER_CHANNELS as readonly string[]).includes(args.channel ?? "")
        ? (args.channel as (typeof VALID_ORDER_CHANNELS)[number])
        : "web";
      const r = await createOrder({
        tenantId,
        channel,
        customerRef: args.customerRef ?? null,
        items: args.items ?? [],
        editorId: ctx?.admin?.id ?? null,
        couponCode: args.couponCode ?? null,
        preferredCarrier: args.preferredCarrier ?? null,
        locationId,
      });
      if (r.status === "CREATED") {
        await audit(ctx, "order.create", r.orderId, { itemCount: (args.items ?? []).length, total: r.total, discount: r.discount, couponCode: r.couponCode });
        const discountNote = r.discount > 0 ? ` (ใช้โค้ดส่วนลด ${r.couponCode} -${r.discount.toLocaleString()} ฿)` : "";
        return { status: r.status, orderId: r.orderId, total: r.total, message: `สร้างออร์เดอร์แล้ว ยอดรวม ${r.total.toLocaleString()} ฿${discountNote}` };
      }
      const messages: Record<string, string> = {
        EMPTY: "ไม่มีรายการสินค้า",
        INVALID_ITEM: r.status === "INVALID_ITEM" ? `รายการที่ ${r.index + 1}: ${r.reason}` : "รายการสินค้าไม่ถูกต้อง",
        NOT_FOUND: `ไม่พบสินค้า ${("sku" in r) ? r.sku : ""} ในระบบ (อาจถูกลบไปแล้ว)`,
        INSUFFICIENT: (r.status === "INSUFFICIENT") ? `${r.sku} (${r.size}) เหลือ ${r.available} ไม่พอสั่ง ${r.requested}` : "สต็อกไม่พอ",
        COUPON_INVALID: r.status === "COUPON_INVALID" ? r.reason : "โค้ดส่วนลดใช้ไม่ได้",
        PHARMACY_POLICY_UNKNOWN: "สินค้านี้ยังไม่มี Product Policy ที่เภสัชกรอนุมัติ",
        PHARMACY_SAFETY_CHECK_REQUIRED: "สินค้านี้ต้องผ่านการตรวจข้อมูลความปลอดภัยก่อน",
        PHARMACY_REVIEW_REQUIRED: "สินค้านี้ต้องผ่านการตรวจโดยเภสัชกรก่อน",
        PHARMACY_PRESCRIPTION_REQUIRED: "สินค้านี้ต้องมีใบสั่งและผ่านการตรวจโดยเภสัชกร",
        PHARMACY_ONLINE_SALE_PROHIBITED: "สินค้านี้ไม่อนุญาตให้สร้างออร์เดอร์ออนไลน์",
        PHARMACY_QUANTITY_LIMIT_EXCEEDED: r.status === "PHARMACY_QUANTITY_LIMIT_EXCEEDED"
          ? `สินค้านี้สั่งได้ไม่เกิน ${r.maxQuantity} ชิ้นต่อครั้ง`
          : "จำนวนเกินข้อกำหนด",
      };
      return { status: r.status, orderId: null, total: null, message: messages[r.status] ?? "สร้างออร์เดอร์ไม่สำเร็จ" };
    },
  },

  // field resolver: ดึงรายการสินค้าในออร์เดอร์
  BmsOrder: {
    async items(parent: { id: string }, _args: unknown, ctx: any) {
      const res = await query(
        `SELECT product_sku, product_name, size, qty, unit_price
           FROM bms_order_items WHERE tenant_id = $2 AND order_id = $1
          ORDER BY id`,
        [parent.id, getTenantId(ctx)]
      );
      return res.rows;
    },
    // มาร์เก็ตเพลส (lazada/shopee/tiktok) = ที่อยู่อยู่ฝั่งแพลตฟอร์ม ไม่ต้องเช็ก — ช่องทางอื่นต้องมีที่อยู่จัดส่งก่อนถึงจัดส่งได้
    async hasShippingAddress(parent: { channel: string; customer_id: string | null; fulfillment_type?: string | null }, _args: unknown, ctx: any) {
      if (parent.fulfillment_type === "PICKUP") return true;
      if (MARKETPLACE_CHANNELS.has(parent.channel)) return true;
      if (!parent.customer_id) return false;
      const res = await query(
        `SELECT 1 FROM bms_customer_addresses
          WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping' LIMIT 1`,
        [getTenantId(ctx), parent.customer_id]
      );
      return (res.rowCount ?? 0) > 0;
    },
    // ส่วนลดแยกที่มา (7.96) — บิลก่อน 7.96 และบิลที่ไม่มีส่วนลดจะได้ [] ปกติ
    async discountLines(parent: { id: string }, _args: unknown, ctx: any) {
      return listOrderDiscounts(getTenantId(ctx), parent.id);
    },
    // normalize ให้ตรง schema (String! สำหรับ timestamps, Float สำหรับ numeric)
    total_amount: (p: any) => Number(p.total_amount),
    discount_amount: (p: any) => Number(p.discount_amount ?? 0),
    shipping_fee: (p: any) => Number(p.shipping_fee ?? 0),
    amount_due: (p: any) => Number(p.amount_due ?? (Number(p.total_amount ?? 0) + Number(p.shipping_fee ?? 0))),
    deposit_paid: (p: any) => Number(p.deposit_paid ?? 0),
    deposit_balance_due: (p: any) => Number(p.deposit_balance_due ?? 0),
    deposit_status: (p: any) => p.deposit_status ?? null,
    coupon_code: (p: any) => p.coupon_code ?? null,
    preferred_carrier: (p: any) => p.preferred_carrier ?? null,
    fulfillmentType: (p: any) => p.fulfillment_type ?? null,
    promisedAt: (p: any) => p.promised_at instanceof Date ? p.promised_at.toISOString() : p.promised_at ?? null,
    locationId: (p: any) => p.location_id ?? null,
    locationName: (p: any) => p.location_name ?? null,
    branchCode: (p: any) => p.branch_code ?? null,
    posDeviceName: (p: any) => p.pos_device_name ?? null,
    registeredPosNo: (p: any) => p.registered_pos_no == null ? null : String(p.registered_pos_no),
    posShiftId: (p: any) => p.pos_shift_id ?? null,
    created_at: (p: any) =>
      p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
    updated_at: (p: any) =>
      p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
  },

  BmsOrderItem: {
    unit_price: (p: any) => Number(p.unit_price),
  },
};
