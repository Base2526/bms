// =============================================================
// BMS Payment — payment records, confirm/reject/refund, slip verify
// -------------------------------------------------------------
// submitPayment      : บันทึกการชำระ (status PENDING) — ยังไม่ขยับ order
// confirmPayment     : PENDING → CONFIRMED + order PENDING → PAID (atomic)
// rejectPayment      : PENDING → REJECTED
// refundPayment      : CONFIRMED → REFUNDED (สิทธิ์ manager)
// verifyPaymentSlip  : OCR/AI อ่านสลิป → "แนะนำ" เท่านั้น (ไม่ยืนยันเอง)
//
// กฎ (BUSINESS_RULES): AI ห้ามยืนยันการชำระเอง — verify แค่ช่วยตรวจ
// การยืนยัน/คืนเงินต้องผ่านสิทธิ์ (payment.confirm / payment.refund)
// =============================================================

import sharp from "sharp";
import crypto from "crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { readStoredFile } from "@/lib/storage";
import { finalizeAiUsageEvent } from "./aiUsage";
import { notifyOrderStatusEmail } from "./orderNotify";
import { notifyOrderActionCommitted } from "./orderActionNotify";
import { redeemCustomerCouponForOrderInTx } from "./coupons";
import { earnPointsForOrderInTx, reviewMemberTierForOrder } from "./membership";
import { markRestockSubscriptionsPurchasedForOrder } from "./restockSubscriptions";
import { slipAmountMatches, type SlipExtract, type SlipImagePolicy, type SlipReader } from "./slipReader";
import { resolveSlipReader, runSlipReaderFallback } from "./slipReaders";

export type { SlipExtract } from "./slipReader";

// WALLET = e-wallet ที่หน้าร้านรับจริง (ทรูมันนี่ / ShopeePay / Rabbit LINE Pay) — เพิ่มที่ 7.87
// STORE_CREDIT = บัตรของขวัญ/เครดิตร้าน — เพิ่มที่ 8.9 · ไม่ใช่เงินที่เข้าร้านรอบนี้
// (ร้านรับเงินไปแล้วตอนขายบัตร) จึงต้องไม่ถูกนับเป็นเงินสดในลิ้นชักหรือยอดรับใหม่
// CREDIT = ขายเชื่อ — เพิ่มที่ 9.30 · แปลว่า "ยังไม่ได้เงิน" ของออกจากร้านแล้วและเกิด
// ลูกหนี้แทน · เงินจริงเข้ามาทีหลังผ่าน bms_ar_receipts ไม่ใช่แถวนี้ จึงต้องไม่ถูกนับ
// เป็นเงินสดในลิ้นชักเช่นกัน (drawerExpectedInTx กรอง method = 'CASH' อยู่แล้ว)
export const PAYMENT_METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH", "WALLET", "STORE_CREDIT", "CREDIT"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type SubmitPaymentInput = {
  tenantId: string;
  orderId: string;
  method: PaymentMethod;
  amount?: number | null; // ไม่ระบุ → ใช้ยอดรวมของ order
  slipUrl?: string | null;
  slipRef?: string | null;
  note?: string | null;
  actor?: string | null;
};

export type SubmitResult =
  | { status: "SUBMITTED"; paymentId: string; amount: number }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "INVALID_ORDER_STATE"; current: string }
  | { status: "BAD_METHOD" };

export type SubmitPaymentOnceResult =
  | SubmitResult
  | {
      status: "ALREADY_SUBMITTED";
      paymentId: string;
      paymentStatus: "PENDING" | "CONFIRMED";
      amount: number;
    };

export type ConfirmResult =
  | { status: "CONFIRMED"; paymentId: string; orderPaid: boolean }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE"; current: string }
  | { status: "INVALID_ORDER_STATE"; current: string }
  | { status: "INVALID_AMOUNT"; expected: number; actual: number };

async function auditPaymentTransitionInTx(
  client: Awaited<ReturnType<typeof getClient>>,
  tenantId: string,
  actor: string | null,
  action: "payment.confirm" | "payment.reject" | "payment.refund" | "payment.partial_refund",
  paymentId: string,
  meta: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
     VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, actor || "admin", action, paymentId, JSON.stringify(meta)]
  );
}

// ---- submit --------------------------------------------------
export async function submitPayment(input: SubmitPaymentInput): Promise<SubmitResult> {
  return submitPaymentInternal(input, false);
}

/**
 * Public checkout uses the order row as a serialization lock and reuses an active payment.
 * A REJECTED payment is intentionally not active, so the customer can upload a replacement slip.
 */
export async function submitPaymentOnce(
  input: SubmitPaymentInput
): Promise<SubmitPaymentOnceResult> {
  return submitPaymentInternal(input, true);
}

async function submitPaymentInternal(
  input: SubmitPaymentInput,
  reuseActive: false
): Promise<SubmitResult>;
async function submitPaymentInternal(
  input: SubmitPaymentInput,
  reuseActive: true
): Promise<SubmitPaymentOnceResult>;
async function submitPaymentInternal(
  input: SubmitPaymentInput,
  reuseActive: boolean
): Promise<SubmitPaymentOnceResult> {
  const { tenantId } = input;
  if (!PAYMENT_METHODS.includes(input.method)) return { status: "BAD_METHOD" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query<{ total_amount: string; shipping_fee: string; rounding_amount: string; status: string }>(
      `SELECT total_amount, shipping_fee, rounding_amount, status
         FROM bms_orders
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, input.orderId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    if (ord.rows[0].status !== "PENDING") {
      const current = ord.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_ORDER_STATE", current };
    }

    if (reuseActive) {
      const active = await client.query<{
        id: string;
        status: "PENDING" | "CONFIRMED";
        amount: string;
      }>(
        `SELECT id, status, amount
           FROM bms_payments
          WHERE tenant_id = $1
            AND order_id = $2
            AND status IN ('PENDING', 'CONFIRMED')
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [tenantId, input.orderId]
      );
      if (active.rows[0]) {
        await client.query("COMMIT");
        return {
          status: "ALREADY_SUBMITTED",
          paymentId: active.rows[0].id,
          paymentStatus: active.rows[0].status,
          amount: Number(active.rows[0].amount),
        };
      }
    }

    // ยอดที่ต้องเก็บ = ค่าสินค้า(หลังส่วนลด) + ค่าส่ง + ยอดปัดเศษเงินสด
    // full payment only: ห้าม override amount เพื่อไม่ให้ยอดรับเงินจริงเพี้ยน
    const amountDue = Number(ord.rows[0].total_amount)
      + Number(ord.rows[0].shipping_fee ?? 0)
      + Number(ord.rows[0].rounding_amount ?? 0);
    const amount = amountDue;

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_payments
         (tenant_id, order_id, method, amount, slip_url, slip_ref, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tenantId, input.orderId, input.method, amount, input.slipUrl ?? null, input.slipRef ?? null, input.note ?? null]
    );

    await client.query("COMMIT");
    return { status: "SUBMITTED", paymentId: ins.rows[0].id, amount };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- confirm (atomic: payment CONFIRMED + order PAID) --------
export async function confirmPayment(
  tenantId: string,
  paymentId: string,
  actor: string | null = "admin"
): Promise<ConfirmResult> {
  const client = await getClient();
  let committed: { paymentId: string; orderId: string | null; orderPaid: boolean } | null = null;
  try {
    await beginTenantTx(client, tenantId);

    const pay = await client.query<{
      status: string; order_id: string | null; amount: string; payable_type: string;
      board_game_reservation_id: string | null; method: string;
    }>(
      `SELECT status, order_id, amount, payable_type, board_game_reservation_id, method
         FROM bms_payments
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, paymentId]
    );
    if (pay.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    if (pay.rows[0].status !== "PENDING") {
      const current = pay.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current };
    }

    if (pay.rows[0].payable_type === "BOARD_GAME_RESERVATION") {
      const reservation = await client.query<{
        status: string; deposit_status: string; deposit_amount: string; deposit_payment_id: string | null;
      }>(
        `SELECT status, deposit_status, deposit_amount, deposit_payment_id
           FROM bms_board_game_waitlist
          WHERE tenant_id = $1 AND id = $2 AND kind = 'RESERVATION' AND source = 'PUBLIC'
          FOR UPDATE`,
        [tenantId, pay.rows[0].board_game_reservation_id],
      );
      const target = reservation.rows[0];
      if (!target) {
        await client.query("ROLLBACK");
        return { status: "NOT_FOUND" };
      }
      if (target.status !== "CONFIRMED" || target.deposit_status !== "SUBMITTED"
        || target.deposit_payment_id !== paymentId) {
        await client.query("ROLLBACK");
        return { status: "INVALID_ORDER_STATE", current: `${target.status}/${target.deposit_status}` };
      }
      const expected = Number(target.deposit_amount);
      const actual = Number(pay.rows[0].amount);
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.01) {
        await client.query("ROLLBACK");
        return { status: "INVALID_AMOUNT", expected, actual: Number.isFinite(actual) ? actual : 0 };
      }
      await client.query(
        `UPDATE bms_payments SET status = 'CONFIRMED', verified_by = $3,
                confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, paymentId, actor],
      );
      await client.query(
        `UPDATE bms_board_game_waitlist
            SET deposit_status = 'PAID', deposit_paid_at = COALESCE(deposit_paid_at, now()),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pay.rows[0].board_game_reservation_id],
      );
      await auditPaymentTransitionInTx(client, tenantId, actor, "payment.confirm", paymentId, {
        boardGameReservationId: pay.rows[0].board_game_reservation_id,
        orderPaid: false,
      });
      await client.query("COMMIT");
      committed = { paymentId, orderId: null, orderPaid: false };
    } else {
      if (!pay.rows[0].order_id) throw new Error("order payment has no order target");

      const orderRes = await client.query<{ total_amount: string; shipping_fee: string; rounding_amount: string; status: string }>(
      `SELECT total_amount, shipping_fee, rounding_amount, status
         FROM bms_orders
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, pay.rows[0].order_id]
    );
      if (orderRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
      }
      if (orderRes.rows[0].status !== "PENDING") {
      const current = orderRes.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_ORDER_STATE", current };
      }
    // + ยอดปัดเศษเงินสด (7.95) — ลูกค้าจ่ายยอดที่ปัดแล้ว ไม่ใช่ยอดดิบ
      const expected = Number(orderRes.rows[0].total_amount)
      + Number(orderRes.rows[0].shipping_fee ?? 0)
      + Number(orderRes.rows[0].rounding_amount ?? 0);
      const actual = Number(pay.rows[0].amount);
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.01) {
      await client.query("ROLLBACK");
      return { status: "INVALID_AMOUNT", expected, actual: Number.isFinite(actual) ? actual : 0 };
      }

      await client.query(
      `UPDATE bms_payments
          SET status = 'CONFIRMED', verified_by = $3,
              confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paymentId, actor]
    );

    // The locked order was verified PENDING above, so payment + order move as
    // one invariant. Never confirm money while silently leaving a conflicting
    // order state behind.
      const ord = await client.query(
      `UPDATE bms_orders SET status = 'PAID', paid_at = COALESCE(paid_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, pay.rows[0].order_id]
    );
      if ((ord.rowCount ?? 0) !== 1) {
      throw new Error("payment/order state changed while confirming");
      }
      if ((ord.rowCount ?? 0) > 0) {
      await redeemCustomerCouponForOrderInTx(client, tenantId, pay.rows[0].order_id);
      // แต้มสะสม (7.96) — ให้ทุกช่องทางที่บิลถึง PAID ไม่ใช่แค่หน้าร้าน
      await earnPointsForOrderInTx(client, { tenantId, orderId: pay.rows[0].order_id, actorUserId: actor });
      await markRestockSubscriptionsPurchasedForOrder({ tenantId, orderId: pay.rows[0].order_id, client });
      }
      await auditPaymentTransitionInTx(client, tenantId, actor, "payment.confirm", paymentId, {
      orderId: pay.rows[0].order_id,
      orderPaid: true,
      });

      await client.query("COMMIT");
      const orderPaid = (ord.rowCount ?? 0) > 0;
      committed = { paymentId, orderId: pay.rows[0].order_id, orderPaid };
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  // All follow-up work runs after releasing the transaction client. Holding one pool slot while
  // the notifier opens another connection can stall every concurrent payment at pool capacity.
  if (committed.orderPaid && committed.orderId) {
    void reviewMemberTierForOrder(tenantId, committed.orderId);
    void notifyOrderStatusEmail(tenantId, committed.orderId, "paid");
    await notifyOrderActionCommitted({ tenantId, orderId: committed.orderId, kind: "ORDER_PAID" });
  }
  return { status: "CONFIRMED", paymentId: committed.paymentId, orderPaid: committed.orderPaid };
}

export type SubmitPartResult =
  | { status: "SUBMITTED"; paymentId: string; amount: number }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "INVALID_ORDER_STATE"; current: string }
  | { status: "BAD_METHOD" }
  | { status: "BAD_AMOUNT"; remaining: number; requested: number };

/**
 * รับเงิน "บางส่วน" ของบิล — สำหรับจ่ายผสมที่หน้าเคาน์เตอร์เท่านั้น
 *
 * submitPayment() ตัวเดิมทิ้ง amount ที่ส่งเข้าไปแล้วใช้ยอดเต็มบิลเสมอ
 * ("full payment only: ห้าม override amount") ซึ่งถูกสำหรับโอนเงินทางไกล —
 * ลูกค้าโอนมาไม่ครบแล้วระบบยอมรับคือช่องโหว่ แต่ทำให้จ่ายสด+บัตรเป็นไปไม่ได้
 *
 * ตัวนี้จึงเป็นทางแยกที่ระบุยอดได้ พร้อมกันเกินด้วยการนับยอดที่ยังค้างอยู่จริง
 * ยอดรวมยังถูกตรวจอีกชั้นตอน confirmPaymentsForOrder()
 */
export async function submitPartialPayment(input: {
  tenantId: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  slipRef?: string | null;
  note?: string | null;
}): Promise<SubmitPartResult> {
  const { tenantId, orderId } = input;
  if (!PAYMENT_METHODS.includes(input.method)) return { status: "BAD_METHOD" };
  const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { status: "BAD_AMOUNT", remaining: 0, requested: amount };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query<{ total_amount: string; shipping_fee: string; rounding_amount: string; status: string }>(
      `SELECT total_amount, shipping_fee, rounding_amount, status FROM bms_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    if (ord.rows[0].status !== "PENDING") {
      const current = ord.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_ORDER_STATE", current };
    }
    const due = Number(ord.rows[0].total_amount)
      + Number(ord.rows[0].shipping_fee ?? 0)
      + Number(ord.rows[0].rounding_amount ?? 0);

    const taken = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM bms_payments
        WHERE tenant_id = $1 AND order_id = $2 AND status IN ('PENDING', 'CONFIRMED')`,
      [tenantId, orderId]
    );
    const remaining = Math.round((due - Number(taken.rows[0].total) + Number.EPSILON) * 100) / 100;
    if (amount - remaining > 0.01) {
      await client.query("ROLLBACK");
      return { status: "BAD_AMOUNT", remaining, requested: amount };
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_payments (tenant_id, order_id, method, amount, slip_ref, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, orderId, input.method, amount, input.slipRef ?? null, input.note ?? null]
    );

    await client.query("COMMIT");
    return { status: "SUBMITTED", paymentId: ins.rows[0].id, amount };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type ConfirmSplitResult =
  | { status: "CONFIRMED"; paymentIds: string[]; orderPaid: boolean }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE"; current: string }
  | { status: "INVALID_ORDER_STATE"; current: string }
  | { status: "INVALID_AMOUNT"; expected: number; actual: number };

/**
 * ยืนยันหลาย payment ของบิลเดียวพร้อมกัน — จ่ายสด 500 + บัตร 300 ในบิล 800
 *
 * confirmPayment() ตัวเดิมเทียบยอดของ payment ใบเดียวกับยอดเต็มบิล ซึ่งถูกสำหรับ
 * โอนเงินทางไกล (1 สลิป = 1 บิล) แต่ปฏิเสธการจ่ายผสมที่หน้าเคาน์เตอร์
 * ตัวนี้เทียบ "ผลรวม" แทน แล้วยืนยันทุกใบในทรานแซกชันเดียว — ยืนยันไม่ครบ
 * แล้วบิลค้างครึ่ง ๆ กลาง ๆ ไม่ได้
 */
export async function confirmPaymentsForOrder(
  tenantId: string,
  orderId: string,
  paymentIds: string[],
  actor: string | null = "admin"
): Promise<ConfirmSplitResult> {
  if (paymentIds.length === 0) return { status: "NOT_FOUND" };
  const client = await getClient();
  let committed: { paymentIds: string[]; orderPaid: boolean } | null = null;
  try {
    await beginTenantTx(client, tenantId);

    const orderRes = await client.query<{ total_amount: string; shipping_fee: string; rounding_amount: string; status: string }>(
      `SELECT total_amount, shipping_fee, rounding_amount, status FROM bms_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (orderRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    if (orderRes.rows[0].status !== "PENDING") {
      const current = orderRes.rows[0].status;
      await client.query("ROLLBACK");
      return { status: "INVALID_ORDER_STATE", current };
    }

    const pays = await client.query<{ id: string; status: string; amount: string }>(
      `SELECT id, status, amount FROM bms_payments
        WHERE tenant_id = $1 AND order_id = $2 AND id = ANY($3::uuid[])
        FOR UPDATE`,
      [tenantId, orderId, paymentIds]
    );
    if (pays.rowCount !== paymentIds.length) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const notPending = pays.rows.find((p) => p.status !== "PENDING");
    if (notPending) {
      const current = notPending.status;
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current };
    }

    const expected = Number(orderRes.rows[0].total_amount)
      + Number(orderRes.rows[0].shipping_fee ?? 0)
      + Number(orderRes.rows[0].rounding_amount ?? 0);
    const actual = pays.rows.reduce((sum, p) => sum + Number(p.amount), 0);
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.01) {
      await client.query("ROLLBACK");
      return { status: "INVALID_AMOUNT", expected, actual: Number.isFinite(actual) ? actual : 0 };
    }

    await client.query(
      `UPDATE bms_payments
          SET status = 'CONFIRMED', verified_by = $3,
              confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, paymentIds, actor]
    );

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'PAID', paid_at = COALESCE(paid_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, orderId]
    );
    if ((ord.rowCount ?? 0) !== 1) {
      throw new Error("payment/order state changed while confirming");
    }
    if ((ord.rowCount ?? 0) > 0) {
      await redeemCustomerCouponForOrderInTx(client, tenantId, orderId);
      await earnPointsForOrderInTx(client, { tenantId, orderId, actorUserId: actor });
      await markRestockSubscriptionsPurchasedForOrder({ tenantId, orderId, client });
    }
    for (const paymentId of paymentIds) {
      await auditPaymentTransitionInTx(client, tenantId, actor, "payment.confirm", paymentId, {
        orderId,
        split: true,
        orderPaid: true,
      });
    }

    await client.query("COMMIT");
    const orderPaid = (ord.rowCount ?? 0) > 0;
    committed = { paymentIds, orderPaid };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  if (committed.orderPaid) {
    void reviewMemberTierForOrder(tenantId, orderId);
    void notifyOrderStatusEmail(tenantId, orderId, "paid");
    await notifyOrderActionCommitted({ tenantId, orderId, kind: "ORDER_PAID" });
  }
  return { status: "CONFIRMED", paymentIds: committed.paymentIds, orderPaid: committed.orderPaid };
}

// ---- reject / refund (simple guarded transitions) ------------
async function setStatus(
  tenantId: string,
  paymentId: string,
  from: string[],
  to: string,
  note?: string | null,
  actor?: string | null
): Promise<boolean> {
  const lifecycleColumn = to === "REJECTED"
    ? "rejected_at"
    : to === "REFUNDED"
      ? "refunded_at"
      : null;
  if (!lifecycleColumn) throw new Error(`unsupported payment transition: ${to}`);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const locked = await client.query<{
      status: string; payable_type: string; board_game_reservation_id: string | null;
      board_game_member_pass_id: string | null; source_payment_id: string | null;
      amount: string; refunded_amount: string;
    }>(
      `SELECT status, payable_type, board_game_reservation_id, board_game_member_pass_id, source_payment_id,
              amount, refunded_amount
         FROM bms_payments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, paymentId],
    );
    const payment = locked.rows[0];
    if (!payment || !from.includes(payment.status)) {
      await client.query("ROLLBACK");
      return false;
    }
    if (payment.source_payment_id) {
      await client.query("ROLLBACK");
      return false;
    }
    // A renewal payment spent store credit and created an entitlement in one transaction. The
    // generic refund button knows neither whether that pass has been consumed nor which credit to
    // restore, so accepting it here would mark money refunded without moving any money back.
    if (to === "REFUNDED" && payment.payable_type === "BOARD_GAME_MEMBER_PASS") {
      await client.query("ROLLBACK");
      return false;
    }
    if (to === "REFUNDED") {
      const allocatedRefund = await client.query(
        `SELECT 1 FROM bms_pos_refund_allocations
          WHERE tenant_id = $1 AND payment_id = $2 LIMIT 1`,
        [tenantId, paymentId],
      );
      if (allocatedRefund.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
    }
    if (to === "REFUNDED" && payment.payable_type === "BOARD_GAME_RESERVATION") {
      const reservation = await client.query<{ deposit_status: string }>(
        `SELECT deposit_status FROM bms_board_game_waitlist
          WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, payment.board_game_reservation_id],
      );
      if (reservation.rows[0]?.deposit_status !== "REFUND_PENDING") {
        await client.query("ROLLBACK");
        return false;
      }
      const applied = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total
           FROM bms_board_game_reservation_deposit_applications
          WHERE tenant_id = $1 AND source_payment_id = $2`,
        [tenantId, paymentId],
      );
      const appliedAmount = Number(applied.rows[0]?.total ?? 0);
      const refundableAmount = Math.max(0, Math.round((Number(payment.amount)
        - appliedAmount - Number(payment.refunded_amount ?? 0)) * 100) / 100);
      if (refundableAmount <= 0) {
        await client.query("ROLLBACK"); return false;
      }
      if (appliedAmount > 0) {
        await client.query(
          `UPDATE bms_payments
              SET refunded_amount = refunded_amount + $3, refunded_at = COALESCE(refunded_at, now()),
                  verified_by = COALESCE($4, verified_by), updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, paymentId, refundableAmount, actor ?? null],
        );
        await client.query(
          `UPDATE bms_board_game_waitlist
              SET deposit_status = 'APPLIED', updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, payment.board_game_reservation_id],
        );
        await auditPaymentTransitionInTx(client, tenantId, actor ?? null,
          "payment.partial_refund", paymentId, { amount: refundableAmount, appliedAmount });
        await client.query("COMMIT");
        return true;
      }
    }
    const res = await client.query(
      `UPDATE bms_payments
          SET status = $4,
              refunded_amount = CASE WHEN $4 = 'REFUNDED' THEN amount ELSE refunded_amount END,
              note = COALESCE($5, note),
              verified_by = COALESCE($6, verified_by),
              ${lifecycleColumn} = COALESCE(${lifecycleColumn}, now()),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = ANY($3)`,
      [tenantId, paymentId, from, to, note ?? null, actor ?? null]
    );
    if ((res.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    if (payment.payable_type === "BOARD_GAME_RESERVATION" && payment.board_game_reservation_id) {
      await client.query(
        `UPDATE bms_board_game_waitlist
            SET deposit_status = $3,
                deposit_payment_id = CASE WHEN $3 = 'PENDING' THEN NULL ELSE deposit_payment_id END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, payment.board_game_reservation_id,
          to === "REJECTED" ? "PENDING" : "REFUNDED"],
      );
    }
    await auditPaymentTransitionInTx(
      client,
      tenantId,
      actor ?? null,
      to === "REJECTED" ? "payment.reject" : "payment.refund",
      paymentId
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ปฏิเสธสลิป: PENDING → REJECTED
 * ไม่คืน coupon quota ที่นี่ เพราะ order ยังเป็น PENDING และลูกค้ายังส่งสลิปใหม่ได้;
 * quota จะคืนเมื่อ order ถูก cancel/auto-release ผ่าน orders.ts เท่านั้น
 */
export function rejectPayment(tenantId: string, paymentId: string, note?: string | null, actor?: string | null) {
  return setStatus(tenantId, paymentId, ["PENDING"], "REJECTED", note, actor);
}

/** คืนเงิน: CONFIRMED → REFUNDED (สิทธิ์ manager ที่ resolver) */
export function refundPayment(tenantId: string, paymentId: string, actor?: string | null) {
  return setStatus(tenantId, paymentId, ["CONFIRMED"], "REFUNDED", null, actor);
}

// ---- read ----------------------------------------------------
export async function getPayment(tenantId: string, id: string) {
  const res = await query(
    `SELECT id, order_id, payable_type, board_game_reservation_id, board_game_member_pass_id, source_payment_id,
            refunded_amount,
            (SELECT deposit_status FROM bms_board_game_waitlist reservation
              WHERE reservation.tenant_id = bms_payments.tenant_id
                AND reservation.id = bms_payments.board_game_reservation_id
            ) AS reservation_deposit_status,
            method, amount, status, slip_url, slip_ref, verify_result, note, verified_by,
            confirmed_at, rejected_at, refunded_at, created_at, updated_at,
            refunded_amount + COALESCE((
              SELECT SUM(a.amount)
                FROM bms_pos_refund_allocations a
               WHERE a.tenant_id = bms_payments.tenant_id
                 AND a.payment_id = bms_payments.id
                 AND a.status = 'COMPLETED'
            ), 0) AS completed_refund_amount,
            COALESCE((
              SELECT SUM(a.amount)
                FROM bms_pos_refund_allocations a
               WHERE a.tenant_id = bms_payments.tenant_id
                 AND a.payment_id = bms_payments.id
                 AND a.status = 'PENDING'
            ), 0) AS pending_refund_amount
       FROM bms_payments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listPayments(
  tenantId: string,
  opts: { search?: string | null; orderId?: string | null; status?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const search = opts.search?.trim() || null;
  const res = await query(
    `SELECT id, order_id, payable_type, board_game_reservation_id, board_game_member_pass_id, source_payment_id,
            refunded_amount,
            (SELECT deposit_status FROM bms_board_game_waitlist reservation
              WHERE reservation.tenant_id = bms_payments.tenant_id
                AND reservation.id = bms_payments.board_game_reservation_id
            ) AS reservation_deposit_status,
            method, amount, status, slip_url, slip_ref, verify_result, note, verified_by,
            confirmed_at, rejected_at, refunded_at, created_at, updated_at,
            refunded_amount + COALESCE((
              SELECT SUM(a.amount)
                FROM bms_pos_refund_allocations a
               WHERE a.tenant_id = bms_payments.tenant_id
                 AND a.payment_id = bms_payments.id
                 AND a.status = 'COMPLETED'
            ), 0) AS completed_refund_amount,
            COALESCE((
              SELECT SUM(a.amount)
                FROM bms_pos_refund_allocations a
               WHERE a.tenant_id = bms_payments.tenant_id
                 AND a.payment_id = bms_payments.id
                 AND a.status = 'PENDING'
            ), 0) AS pending_refund_amount
       FROM bms_payments
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR order_id = $2)
        AND ($3::text IS NULL OR status = $3)
        AND (
          $6::text IS NULL
          OR id::text ILIKE '%' || $6 || '%'
          OR order_id::text ILIKE '%' || $6 || '%'
          OR COALESCE(board_game_reservation_id::text, '') ILIKE '%' || $6 || '%'
          OR COALESCE(board_game_member_pass_id::text, '') ILIKE '%' || $6 || '%'
          OR method ILIKE '%' || $6 || '%'
          OR COALESCE(slip_ref, '') ILIKE '%' || $6 || '%'
          OR COALESCE(verified_by, '') ILIKE '%' || $6 || '%'
          OR COALESCE(note, '') ILIKE '%' || $6 || '%'
        )
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, opts.orderId ?? null, opts.status ?? null, limit, offset, search]
  );
  return res.rows;
}

// =============================================================
// verifyPaymentSlip — OCR/AI (แนะนำเท่านั้น ไม่เปลี่ยนสถานะ)
// -------------------------------------------------------------
//   • ไม่มี credentials/credits หรืออ่านสลิปไม่ได้ → heuristic (ต้องตรวจเอง)
//   • มี key + สลิปเป็นรูป → SlipReader adapter สกัด amount/date/ref แล้วเทียบยอด
// =============================================================

export type SlipVerification = {
  method: "ai" | "heuristic";
  provider: string | null;
  extracted: SlipExtract | null;
  expectedAmount: number;
  amountMatch: boolean;
  verified: boolean; // true = AI มั่นใจว่ายอดตรง (ยังต้องให้คนกดยืนยันอยู่ดี)
  reason: string;
  checkedAt: string;
};

const DEFAULT_SLIP_IMAGE_POLICY: SlipImagePolicy = {
  maxImagePixels: 1_229_312,
  safeRawBytes: 4 * 1024 * 1024,
  resizePatchPx: 28,
  passThroughMediaTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
};

const visualTokensFor = (w: number, h: number, patchPx: number) =>
  Math.ceil(w / patchPx) * Math.ceil(h / patchPx);

function maxVisualTokens(policy: SlipImagePolicy): number | null {
  if (!policy.resizePatchPx || policy.resizePatchPx <= 0) return null;
  return Math.max(1, Math.floor(policy.maxImagePixels / (policy.resizePatchPx * policy.resizePatchPx)));
}

function fitsImagePolicy(
  width: number,
  height: number,
  policy: SlipImagePolicy
): boolean {
  if (width <= 0 || height <= 0) return false;
  const budget = maxVisualTokens(policy);
  if (budget && policy.resizePatchPx) {
    return visualTokensFor(width, height, policy.resizePatchPx) <= budget;
  }
  return width * height <= policy.maxImagePixels;
}

/** แปลง /api/files/<id> → { base64, mediaType } (อ่านผ่าน storage driver) */
async function loadSlipImage(
  slipUrl: string,
  reader: SlipReader
): Promise<{ base64: string; mediaType: string } | null> {
  const m = slipUrl.match(/\/api\/files\/(\d+)/);
  if (!m) return null;
  const fileId = Number(m[1]);
  const res = await query<{ relpath: string; mimetype: string | null }>(
    `SELECT relpath, mimetype FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [fileId]
  );
  if (res.rowCount === 0) return null;
  const { relpath, mimetype } = res.rows[0];
  const mediaType = mimetype || "image/jpeg";
  if (!mediaType.startsWith("image/")) return null;

  let buf: Buffer;
  try {
    buf = await readStoredFile(relpath);
  } catch {
    return null;
  }

  try {
    const image = sharp(buf, { failOn: "none" });
    const policy = reader.imagePolicy ?? DEFAULT_SLIP_IMAGE_POLICY;
    const passThroughTypes = new Set(
      (policy.passThroughMediaTypes ?? DEFAULT_SLIP_IMAGE_POLICY.passThroughMediaTypes ?? []).map(
        (value) => value.toLowerCase()
      )
    );
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const pixels = width * height;
    // เล็กและอยู่ในเพดานอยู่แล้ว → ส่งไฟล์เดิมไม่แตะต้อง (ไม่ re-encode = ไม่เสี่ยงเสียความคมของตัวอักษร)
    if (
      fitsImagePolicy(width, height, policy) &&
      buf.byteLength <= policy.safeRawBytes &&
      passThroughTypes.has(mediaType.toLowerCase())
    ) {
      return { base64: buf.toString("base64"), mediaType };
    }
    const scale = pixels > policy.maxImagePixels ? Math.sqrt(policy.maxImagePixels / pixels) : 1;
    const boxFor = (value: number) => {
      if (policy.resizePatchPx && policy.resizePatchPx > 0) {
        return Math.max(
          policy.resizePatchPx,
          Math.floor((value * scale) / policy.resizePatchPx) * policy.resizePatchPx
        );
      }
      return Math.max(1, Math.floor(value * scale));
    };
    const resized = await image
      .rotate() // เคารพ EXIF orientation ก่อนย่อ ไม่งั้นสลิปจากมือถืออาจตะแคง
      .resize({
        width: boxFor(width || 1),
        height: boxFor(height || 1),
        fit: "inside",
        withoutEnlargement: true,
      })
      // q90 ใกล้ lossless พอสำหรับ OCR ตัวเลขบนสลิป แต่เล็กกว่า PNG ของรูปถ่ายหลายเท่า
      .jpeg({ quality: 90 })
      .toBuffer();
    const out = await sharp(resized).metadata();
    const budget = maxVisualTokens(policy);
    if (budget && policy.resizePatchPx) {
      const outTokens = visualTokensFor(out.width ?? 1, out.height ?? 1, policy.resizePatchPx);
      if (outTokens > budget) {
        console.warn(
          `[BMS] slip image still ${outTokens} visual tokens after downscale for ${reader.provider}`
        );
      }
    } else if (!fitsImagePolicy(out.width ?? 0, out.height ?? 0, policy)) {
      console.warn(
        `[BMS] slip image still exceeds image policy after downscale for ${reader.provider}`
      );
    }
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch (err) {
    console.error("[BMS] slip image downscale failed:", err);
    const policy = reader.imagePolicy ?? DEFAULT_SLIP_IMAGE_POLICY;
    // ย่อไม่ได้ (ไฟล์เสีย/ฟอร์แมตแปลก) — ส่งไฟล์เดิมได้เฉพาะตอนที่มั่นใจว่าไม่เกินเพดานของ provider
    // ถ้าใหญ่เกินก็ยอมตกไป heuristic ให้คนตรวจ ดีกว่าโดน API ปฏิเสธทั้ง request
    if (buf.byteLength <= policy.safeRawBytes) {
      return { base64: buf.toString("base64"), mediaType };
    }
    return null;
  }
}

export async function verifyPaymentSlip(tenantId: string, paymentId: string): Promise<SlipVerification | null> {
  const pay = await query<{ amount: string; slip_url: string | null }>(
    `SELECT amount, slip_url FROM bms_payments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, paymentId]
  );
  if (pay.rowCount === 0) return null;

  const expectedAmount = Number(pay.rows[0].amount);
  const checkedAt = new Date().toISOString();

  let result: SlipVerification | null = null;
  let fallbackReason =
    "AI อ่านสลิปยังไม่พร้อมใช้งานหรือเครดิตไม่เพียงพอ — ตรวจสอบด้วยตนเอง";

  if (pay.rows[0].slip_url) {
    const usageGroupId = crypto.randomUUID();
    const attempt = await runSlipReaderFallback({
      resolveNext: (excluded, fallbackFrom, chargeSharedCredit) =>
        resolveSlipReader(
          tenantId,
          {
            surface: "staff",
            feature: "payment_slip_ocr",
            meta: { paymentId, usage_group_id: usageGroupId },
          },
          { excludeProviders: excluded, fallbackFrom, chargeSharedCredit }
        ),
      loadImage: (reader) => loadSlipImage(pay.rows[0].slip_url as string, reader),
      finalize: finalizeAiUsageEvent,
    });

    if (attempt.ok) {
      const readResult = attempt.result;
      const { extracted } = readResult;
      const amountMatch = slipAmountMatches(extracted.amount, expectedAmount);
      result = {
        method: "ai",
        provider: readResult.provider,
        extracted,
        expectedAmount,
        amountMatch,
        verified: amountMatch,
        reason: amountMatch
          ? `ยอดในสลิป (${extracted.amount}) ตรงกับยอดที่ต้องชำระ — กรุณากดยืนยันเพื่อรับชำระ`
          : `ยอดในสลิป (${extracted.amount ?? "อ่านไม่ได้"}) ไม่ตรงกับยอด ${expectedAmount} — ตรวจสอบก่อนยืนยัน`,
        checkedAt,
      };
    } else if (attempt.reason === "image_unavailable") {
      fallbackReason = "ไม่สามารถโหลดรูปสลิปได้ — ตรวจสอบด้วยตนเอง";
    } else if (attempt.attemptedProviders.length >= 2) {
      fallbackReason =
        "OCR provider ทั้งตัวหลักและตัวสำรองอ่านสลิปไม่สำเร็จ — กรุณาตรวจสอบด้วยตนเอง";
    } else if (attempt.attemptedProviders.length === 1) {
      fallbackReason = `${attempt.attemptedProviders[0]} อ่านสลิปไม่สำเร็จและ provider สำรองไม่พร้อม — กรุณาตรวจสอบด้วยตนเอง`;
    }
  }

  if (!result) {
    const reason = !pay.rows[0].slip_url
      ? "ไม่มีรูปสลิปให้ตรวจ (ไม่มี slip_url ที่เป็นรูป) — ตรวจสอบด้วยตนเอง"
      : fallbackReason;
    result = {
      method: "heuristic", provider: null, extracted: null, expectedAmount, amountMatch: false,
      verified: false,
      reason,
      checkedAt,
    };
  }

  await query(
    `UPDATE bms_payments SET verify_result = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, paymentId, JSON.stringify(result)]
  );
  return result;
}
