// =============================================================
// BMS — มัดจำ / ค้างชำระ (9.0)
// -------------------------------------------------------------
// POS บังคับว่ายอดชำระต้องเท่ายอดบิลพอดี ไม่งั้นตีตก PAYMENT_MISMATCH · กฎนั้นถูก
// สำหรับการขายที่จบที่เคาน์เตอร์ และ **ไม่ถูกคลาย** ในไฟล์นี้ เพราะมันคือสิ่งที่กัน
// การเก็บเงินไม่ตรงกับที่ระบบคิด
//
// มัดจำจึงเป็นบิลอีกชนิด ไม่ใช่การผ่อนปรนกฎเดิม:
//   รับมัดจำ → ของถูกจอง (reserved) บิลค้างที่ PENDING
//   ลูกค้ากลับมาจ่ายส่วนที่เหลือ → บิลเดินเส้นทางปิดการขายตามปกติทั้งเส้น
//     (ตัดสต็อก ออกใบกำกับ ให้แต้ม) ซึ่งเป็นเส้นทางเดิมที่ผ่านการทดสอบมาแล้ว
//
// ผลที่ตามมาโดยตั้งใจ: ใบกำกับภาษีออกตอน "รับของ" ไม่ใช่ตอนวางมัดจำ ซึ่งตรงกับ
// จุดที่กรรมสิทธิ์ในสินค้าโอนจริง
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type Deposit = {
  id: string;
  orderId: string;
  customerId: string | null;
  customerNote: string | null;
  totalAmount: number;
  depositPaid: number;
  balanceDue: number;
  status: "OPEN" | "COMPLETED" | "CANCELLED" | "FORFEITED";
  dueAt: string | null;
  createdAt: string;
  /** true = เลยกำหนดรับแล้ว — ของถูกจองค้างอยู่และขายให้คนอื่นไม่ได้ */
  overdue: boolean;
};

const toISO = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const round2 = (n: number) => Math.round(n * 100) / 100;

function mapDeposit(r: any): Deposit {
  const total = Number(r.total_amount);
  const paid = Number(r.deposit_paid);
  const dueAt = r.due_at ? toISO(r.due_at) : null;
  return {
    id: r.id,
    orderId: r.order_id,
    customerId: r.customer_id ?? null,
    customerNote: r.customer_note ?? null,
    totalAmount: total,
    depositPaid: paid,
    balanceDue: round2(total - paid),
    status: r.status,
    dueAt,
    createdAt: toISO(r.created_at),
    overdue: r.status === "OPEN" && Boolean(dueAt) && new Date(dueAt!).getTime() < Date.now(),
  };
}

export async function listDeposits(
  tenantId: string, status: Deposit["status"] | null = "OPEN"
): Promise<Deposit[]> {
  const res = await query<any>(
    `SELECT * FROM bms_pos_deposits
      WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY due_at NULLS LAST, created_at DESC
      LIMIT 200`,
    [tenantId, status]
  );
  return res.rows.map(mapDeposit);
}

export async function getDepositByOrder(tenantId: string, orderId: string): Promise<Deposit | null> {
  const res = await query<any>(
    `SELECT * FROM bms_pos_deposits WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  return res.rows[0] ? mapDeposit(res.rows[0]) : null;
}

export type TakeDepositResult =
  | { status: "TAKEN"; deposit: Deposit }
  | { status: "INVALID"; reason: string }
  | { status: "ORDER_NOT_ELIGIBLE"; reason: string };

/**
 * รับมัดจำสำหรับบิลที่สร้างไว้แล้ว (สถานะ PENDING — ของถูกจองแล้วแต่ยังไม่ตัด)
 *
 * มัดจำต้องมากกว่า 0 และน้อยกว่ายอดบิล: เท่ายอดบิลพอดีไม่ใช่มัดจำ นั่นคือการขายจบ
 * ซึ่งต้องเดินเส้นทางปกติเพื่อให้ได้ใบกำกับ/แต้ม/การตัดสต็อกครบ · ปล่อยผ่านคือบิลที่
 * จ่ายครบแล้วแต่ค้างอยู่ในรายการมัดจำโดยไม่มีใครไปปิด
 */
export async function takeDeposit(input: {
  tenantId: string;
  orderId: string;
  amount: number;
  method: string;
  deviceId?: string | null;
  shiftId?: string | null;
  customerNote?: string | null;
  dueAt?: string | null;
  createdBy: string;
}): Promise<TakeDepositResult> {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { status: "INVALID", reason: "ยอดมัดจำต้องมากกว่า 0" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.createdBy });

    const ord = await client.query<any>(
      `SELECT id, status, total_amount, shipping_fee, location_id, customer_id
         FROM bms_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.orderId]
    );
    const order = ord.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_ELIGIBLE", reason: "ไม่พบบิลนี้" };
    }
    if (order.status !== "PENDING") {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_ELIGIBLE", reason: `บิลสถานะ ${order.status} รับมัดจำไม่ได้` };
    }

    const total = round2(Number(order.total_amount) + Number(order.shipping_fee ?? 0));
    if (amount >= total) {
      await client.query("ROLLBACK");
      return {
        status: "INVALID",
        reason: `ยอดมัดจำต้องน้อยกว่ายอดบิล (฿${total.toFixed(2)}) — จ่ายครบคือปิดการขายตามปกติ`,
      };
    }

    const existing = await client.query(
      `SELECT 1 FROM bms_pos_deposits WHERE tenant_id = $1 AND order_id = $2`,
      [input.tenantId, input.orderId]
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "บิลนี้มีมัดจำอยู่แล้ว" };
    }

    // เงินมัดจำเป็นการชำระเงินจริง — ลงตาราง payments ให้เห็นในกะและรายงาน
    // สถานะ CONFIRMED เพราะเงินอยู่ในมือร้านแล้ว ต่างจาก PENDING ที่รอตรวจสลิป
    await client.query(
      `INSERT INTO bms_payments (tenant_id, order_id, method, amount, status, verified_by, updated_at)
       VALUES ($1,$2,$3,$4,'CONFIRMED',$5,now())`,
      [input.tenantId, input.orderId, input.method, amount, input.createdBy]
    );

    const ins = await client.query<any>(
      `INSERT INTO bms_pos_deposits
         (tenant_id, order_id, location_id, device_id, shift_id, customer_id, customer_note,
          total_amount, deposit_paid, due_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11)
       RETURNING *`,
      [input.tenantId, input.orderId, order.location_id, input.deviceId ?? null, input.shiftId ?? null,
        order.customer_id ?? null, input.customerNote ?? null, total, amount,
        input.dueAt ?? null, input.createdBy]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.deposit.take',$3,$4)`,
      [input.tenantId, input.createdBy, input.orderId,
        JSON.stringify({ amount, total, method: input.method })]
    );
    await client.query("COMMIT");
    return { status: "TAKEN", deposit: mapDeposit(ins.rows[0]) };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** เพิ่มเงินมัดจำงวดถัดไป (ลูกค้ามาจ่ายเพิ่มแต่ยังไม่ครบ) */
export async function addToDeposit(input: {
  tenantId: string; orderId: string; amount: number; method: string; actorUserId: string;
}): Promise<TakeDepositResult> {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { status: "INVALID", reason: "ยอดต้องมากกว่า 0" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const cur = await client.query<any>(
      `SELECT * FROM bms_pos_deposits WHERE tenant_id = $1 AND order_id = $2 AND status = 'OPEN' FOR UPDATE`,
      [input.tenantId, input.orderId]
    );
    const dep = cur.rows[0];
    if (!dep) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบมัดจำที่ยังเปิดอยู่ของบิลนี้" };
    }
    const remaining = round2(Number(dep.total_amount) - Number(dep.deposit_paid));
    if (amount > remaining) {
      await client.query("ROLLBACK");
      return {
        status: "INVALID",
        reason: `เหลือค้างอยู่ ฿${remaining.toFixed(2)} — จ่ายเท่านี้พอดีคือรับของ ต้องปิดบิลไม่ใช่เพิ่มมัดจำ`,
      };
    }

    await client.query(
      `INSERT INTO bms_payments (tenant_id, order_id, method, amount, status, verified_by, updated_at)
       VALUES ($1,$2,$3,$4,'CONFIRMED',$5,now())`,
      [input.tenantId, input.orderId, input.method, amount, input.actorUserId]
    );
    const upd = await client.query<any>(
      `UPDATE bms_pos_deposits SET deposit_paid = deposit_paid + $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [input.tenantId, dep.id, amount]
    );
    await client.query("COMMIT");
    return { status: "TAKEN", deposit: mapDeposit(upd.rows[0]) };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type CancelDepositResult =
  | { status: "CANCELLED"; refundable: number }
  | { status: "FORFEITED"; forfeited: number }
  | { status: "INVALID"; reason: string };

/**
 * ยกเลิกมัดจำ — ของกลับไปขายได้ และร้านตัดสินใจว่าคืนเงินหรือยึด
 *
 * ไม่คืนเงินให้อัตโนมัติ: การคืนหรือยึดมัดจำเป็นข้อตกลงระหว่างร้านกับลูกค้า
 * (บางร้านยึดถ้าเลยกำหนด บางร้านคืนเต็ม) ระบบบันทึกการตัดสินใจนั้นแล้วให้พนักงาน
 * จ่ายเงินคืนผ่านทางคืนเงินปกติถ้าตกลงว่าคืน — ตัดสินใจแทนร้านคือตัดสินใจเรื่องเงิน
 * ของคนอื่น
 *
 * การยกเลิกบิล (คืน reserved) ทำโดยผู้เรียกผ่าน cancelOrder เพื่อให้เส้นทางคืนของ
 * มีที่เดียว
 */
export async function closeDeposit(input: {
  tenantId: string;
  orderId: string;
  outcome: "CANCELLED" | "FORFEITED";
  reason: string;
  actorUserId: string;
}): Promise<CancelDepositResult> {
  const reason = input.reason.trim();
  if (!reason) return { status: "INVALID", reason: "ต้องระบุเหตุผล" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const cur = await client.query<any>(
      `SELECT * FROM bms_pos_deposits WHERE tenant_id = $1 AND order_id = $2 AND status = 'OPEN' FOR UPDATE`,
      [input.tenantId, input.orderId]
    );
    const dep = cur.rows[0];
    if (!dep) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบมัดจำที่ยังเปิดอยู่ของบิลนี้" };
    }
    await client.query(
      `UPDATE bms_pos_deposits
          SET status = $3, cancelled_at = now(), cancelled_by = $4, cancel_reason = $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, dep.id, input.outcome, input.actorUserId, reason]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.deposit.close',$3,$4)`,
      [input.tenantId, input.actorUserId, input.orderId,
        JSON.stringify({ outcome: input.outcome, reason, depositPaid: Number(dep.deposit_paid) })]
    );
    await client.query("COMMIT");

    const paid = Number(dep.deposit_paid);
    return input.outcome === "FORFEITED"
      ? { status: "FORFEITED", forfeited: paid }
      : { status: "CANCELLED", refundable: paid };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** ปิดมัดจำเมื่อลูกค้ามารับของและจ่ายครบ — เรียกในทรานแซกชันที่ปิดการขาย */
export async function markDepositCompletedInTx(
  client: import("pg").PoolClient, tenantId: string, orderId: string
): Promise<void> {
  await client.query(
    `UPDATE bms_pos_deposits
        SET status = 'COMPLETED', deposit_paid = total_amount, completed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND order_id = $2 AND status = 'OPEN'`,
    [tenantId, orderId]
  );
}
