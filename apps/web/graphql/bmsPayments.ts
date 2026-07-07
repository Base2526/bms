// =============================================================
// GraphQL resolvers — BMS Payment (admin panel)
// -------------------------------------------------------------
// บันทึกการชำระ / ยืนยัน / ปฏิเสธ / คืนเงิน / ตรวจสลิป (OCR-AI)
// ใช้ service เดียวกับ REST (lib/bms/payments) — ตรรกะไม่ซ้ำ
// permission enforce ทุก field + audit ทุก mutation ที่สำเร็จ
//   • confirmPayment → order PENDING → PAID (atomic ใน service)
//   • verifyPaymentSlip = AI "แนะนำ" เท่านั้น ไม่เปลี่ยนสถานะ
// =============================================================

import {
  submitPayment,
  confirmPayment,
  rejectPayment,
  refundPayment,
  verifyPaymentSlip,
  listPayments,
  getPayment,
  type PaymentMethod,
} from "@/lib/bms/payments";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { audit } from "@/lib/bms/audit";

const toISO = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const actorOf = (ctx: any) => ctx?.admin?.email || ctx?.admin?.id || "admin";

export const bmsPaymentsResolvers = {
  Query: {
    async bmsPayments(
      _p: unknown,
      args: { orderId?: string; status?: string; limit?: number; offset?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "payment.view");
      return listPayments(getTenantId(ctx), {
        orderId: args.orderId ?? null,
        status: args.status ?? null,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
    },

    async bmsPayment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "payment.view");
      return getPayment(getTenantId(ctx), args.id);
    },
  },

  Mutation: {
    async bmsSubmitPayment(
      _p: unknown,
      args: {
        orderId: string; method: PaymentMethod; amount?: number;
        slipUrl?: string; slipRef?: string; note?: string;
      },
      ctx: any
    ) {
      await requirePermission(ctx, "payment.submit");
      const res = await submitPayment({
        tenantId: getTenantId(ctx),
        orderId: args.orderId,
        method: args.method,
        amount: args.amount ?? null,
        slipUrl: args.slipUrl ?? null,
        slipRef: args.slipRef ?? null,
        note: args.note ?? null,
        actor: actorOf(ctx),
      });
      if (res.status === "SUBMITTED") {
        await audit(ctx, "payment.submit", res.paymentId, { orderId: args.orderId, amount: res.amount });
        return { status: "SUBMITTED", paymentId: res.paymentId, message: "บันทึกการชำระแล้ว (รอยืนยัน)" };
      }
      const msg: Record<string, string> = {
        ORDER_NOT_FOUND: "ไม่พบออร์เดอร์",
        BAD_METHOD: "วิธีชำระเงินไม่ถูกต้อง",
      };
      return { status: res.status, paymentId: null, message: msg[res.status] ?? "ทำรายการไม่ได้" };
    },

    async bmsConfirmPayment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "payment.confirm");
      const res = await confirmPayment(getTenantId(ctx), args.id, actorOf(ctx));
      if (res.status === "CONFIRMED") {
        await audit(ctx, "payment.confirm", args.id, { orderPaid: res.orderPaid });
        return { status: "CONFIRMED", paymentId: args.id, message: res.orderPaid ? "ยืนยันแล้ว · ออร์เดอร์เป็น PAID" : "ยืนยันการชำระแล้ว" };
      }
      const msg: Record<string, string> = {
        NOT_FOUND: "ไม่พบรายการชำระ",
        INVALID_STATE: "สถานะไม่อนุญาตให้ยืนยัน",
      };
      return { status: res.status, paymentId: args.id, message: msg[res.status] ?? "ยืนยันไม่ได้" };
    },

    async bmsRejectPayment(_p: unknown, args: { id: string; note?: string }, ctx: any) {
      await requirePermission(ctx, "payment.confirm");
      const ok = await rejectPayment(getTenantId(ctx), args.id, args.note ?? null, actorOf(ctx));
      if (ok) await audit(ctx, "payment.reject", args.id);
      return ok;
    },

    async bmsRefundPayment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "payment.refund");
      const ok = await refundPayment(getTenantId(ctx), args.id, actorOf(ctx));
      if (ok) await audit(ctx, "payment.refund", args.id);
      return ok;
    },

    async bmsVerifyPaymentSlip(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "payment.confirm");
      const res = await verifyPaymentSlip(getTenantId(ctx), args.id);
      if (!res) return null;
      await audit(ctx, "payment.verify", args.id, { method: res.method, verified: res.verified });
      return res;
    },
  },

  // field resolvers — normalize snake_case + numeric/JSON
  BmsPayment: {
    orderId: (p: any) => p.order_id,
    slipUrl: (p: any) => p.slip_url ?? null,
    slipRef: (p: any) => p.slip_ref ?? null,
    verifiedBy: (p: any) => p.verified_by ?? null,
    amount: (p: any) => Number(p.amount),
    verifyResult: (p: any) =>
      p.verify_result == null ? null : typeof p.verify_result === "string" ? p.verify_result : JSON.stringify(p.verify_result),
    createdAt: (p: any) => toISO(p.created_at),
    updatedAt: (p: any) => toISO(p.updated_at),
  },
};
