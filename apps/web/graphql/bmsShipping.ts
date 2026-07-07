// =============================================================
// GraphQL resolvers — BMS Shipping (admin panel)
// -------------------------------------------------------------
// สร้าง shipment (ship จริง) / แก้ tracking / เปลี่ยนสถานะ / label
// ใช้ service เดียวกับ REST (lib/bms/shipping) — ตรรกะไม่ซ้ำ
// permission enforce ทุก field + audit ทุก mutation ที่สำเร็จ
//   • createShipment: order PACKING → SHIPPED + ตัดสต็อก (atomic ใน service)
//   • setShipmentStatus DELIVERED → order → COMPLETED
// =============================================================

import {
  createShipment,
  updateTracking,
  setShipmentStatus,
  cancelShipment,
  getShipment,
  listShipments,
  getShipmentLabel,
  type Carrier,
  type ShipmentStatus,
} from "@/lib/bms/shipping";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

const toISO = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const actorOf = (ctx: any) => ctx?.admin?.email || ctx?.admin?.id || "admin";

export const bmsShippingResolvers = {
  Query: {
    async bmsShipments(
      _p: unknown,
      args: { orderId?: string; status?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "shipping.view");
      return listShipments(getTenantId(ctx), {
        orderId: args.orderId ?? null,
        status: args.status ?? null,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
    },

    async bmsShipment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "shipping.view");
      return getShipment(getTenantId(ctx), args.id);
    },

    async bmsShipmentLabel(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "shipping.view");
      return getShipmentLabel(getTenantId(ctx), args.id);
    },
  },

  Mutation: {
    async bmsCreateShipment(
      _p: unknown,
      args: { orderId: string; carrier: Carrier; trackingNo?: string; note?: string },
      ctx: any
    ) {
      await requirePermission(ctx, "shipping.create");
      const res = await createShipment({
        tenantId: getTenantId(ctx),
        orderId: args.orderId,
        carrier: args.carrier,
        trackingNo: args.trackingNo ?? null,
        note: args.note ?? null,
        actor: actorOf(ctx),
      });
      if (res.status === "CREATED") {
        await audit(ctx, "shipping.create", res.shipmentId, { orderId: args.orderId, orderShipped: res.orderShipped });
        return {
          status: "CREATED",
          shipmentId: res.shipmentId,
          message: res.orderShipped ? "สร้างการจัดส่ง · ออร์เดอร์เป็น SHIPPED (ตัดสต็อกแล้ว)" : "แนบการจัดส่งกับออร์เดอร์แล้ว",
        };
      }
      const msg: Record<string, string> = {
        ORDER_NOT_FOUND: "ไม่พบออร์เดอร์",
        BAD_CARRIER: "ขนส่งไม่ถูกต้อง",
        INVALID_STATE: "สถานะออร์เดอร์ไม่อนุญาตให้จัดส่ง (ต้องเป็น PACKING/SHIPPED)",
      };
      return { status: res.status, shipmentId: null, message: msg[res.status] ?? "ทำรายการไม่ได้" };
    },

    async bmsUpdateTracking(
      _p: unknown,
      args: { id: string; trackingNo?: string; carrier?: Carrier },
      ctx: any
    ) {
      await requirePermission(ctx, "shipping.update");
      const ok = await updateTracking(
        getTenantId(ctx),
        args.id,
        { trackingNo: args.trackingNo ?? null, carrier: args.carrier ?? null },
        actorOf(ctx)
      );
      if (ok) await audit(ctx, "shipping.update_tracking", args.id, { trackingNo: args.trackingNo, carrier: args.carrier });
      return ok;
    },

    async bmsSetShipmentStatus(_p: unknown, args: { id: string; status: ShipmentStatus }, ctx: any) {
      await requirePermission(ctx, "shipping.update");
      const ok = await setShipmentStatus(getTenantId(ctx), args.id, args.status);
      if (ok) await audit(ctx, "shipping.set_status", args.id, { status: args.status });
      return ok;
    },

    async bmsCancelShipment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "shipping.update");
      const ok = await cancelShipment(getTenantId(ctx), args.id);
      if (ok) await audit(ctx, "shipping.cancel", args.id);
      return ok;
    },
  },

  // field resolvers — normalize snake_case
  BmsShipment: {
    orderId: (p: any) => p.order_id,
    trackingNo: (p: any) => p.tracking_no ?? null,
    labelUrl: (p: any) => p.label_url ?? null,
    createdAt: (p: any) => toISO(p.created_at),
    updatedAt: (p: any) => toISO(p.updated_at),
  },
};
