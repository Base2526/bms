// Writes short-lived fixture rows to a development database and removes them.
// Run from apps/web with the normal DB-contract environment.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { confirmPayment, refundPayment } from "../apps/web/lib/bms/payments.ts";

const REF = `data-integrity-contract-${process.pid}`;
const ACTOR = "contract:data-integrity";
let tenantId = "";
let locationId = "";
const orderIds: string[] = [];
const paymentIds: string[] = [];

async function cleanup() {
  if (paymentIds.length) {
    await query(`DELETE FROM bms_audit_log WHERE tenant_id=$1 AND target=ANY($2::text[])`, [tenantId, paymentIds]);
    await query(`DELETE FROM bms_payments WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [tenantId, paymentIds]);
  }
  if (orderIds.length) {
    await query(`DELETE FROM bms_orders WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [tenantId, orderIds]);
  }
}

async function fixture(orderStatus: "PENDING" | "CANCELLED" = "PENDING") {
  const order = await query<{ id: string }>(
    `INSERT INTO bms_orders
       (tenant_id,location_id,channel,customer_ref,status,total_amount,shipping_fee,rounding_amount)
     VALUES ($1,$2,'test',$3,$4,100,10,-0.02)
     RETURNING id`,
    [tenantId, locationId, REF, orderStatus]
  );
  const orderId = order.rows[0].id;
  orderIds.push(orderId);
  const payment = await query<{ id: string }>(
    `INSERT INTO bms_payments (tenant_id,order_id,method,amount,status)
     VALUES ($1,$2,'CASH',109.98,'PENDING') RETURNING id`,
    [tenantId, orderId]
  );
  const paymentId = payment.rows[0].id;
  paymentIds.push(paymentId);
  return { orderId, paymentId };
}

before(async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id=$1 ORDER BY is_head_office DESC,created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  await query(`DELETE FROM bms_orders WHERE tenant_id=$1 AND customer_ref=$2`, [tenantId, REF]);
});

after(cleanup);

test("confirm commits payment, order, lifecycle timestamps, and audit together", async () => {
  const { orderId, paymentId } = await fixture();
  const result = await confirmPayment(tenantId, paymentId, ACTOR);
  assert.deepEqual(result, { status: "CONFIRMED", paymentId, orderPaid: true });
  const state = await query<any>(
    `SELECT p.status payment_status,p.confirmed_at,o.status order_status,o.paid_at,
            EXISTS(SELECT 1 FROM bms_audit_log a
                    WHERE a.tenant_id=$1 AND a.target=$2::text AND a.action='payment.confirm') audited
       FROM bms_payments p JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
      WHERE p.tenant_id=$1 AND p.id=$2::uuid`,
    [tenantId, paymentId]
  );
  assert.equal(state.rows[0].payment_status, "CONFIRMED");
  assert.equal(state.rows[0].order_status, "PAID");
  assert.ok(state.rows[0].confirmed_at);
  assert.ok(state.rows[0].paid_at);
  assert.equal(state.rows[0].audited, true);

  assert.equal(await refundPayment(tenantId, paymentId, ACTOR), true);
  const refunded = await query<any>(
    `SELECT refunded_at,
            EXISTS(SELECT 1 FROM bms_audit_log a
                    WHERE a.tenant_id=$1 AND a.target=$2::text AND a.action='payment.refund') audited
       FROM bms_payments WHERE tenant_id=$1 AND id=$2::uuid`,
    [tenantId, paymentId]
  );
  assert.ok(refunded.rows[0].refunded_at);
  assert.equal(refunded.rows[0].audited, true);
});

test("a conflicting order state rolls back payment confirmation", async () => {
  const { paymentId } = await fixture("CANCELLED");
  const result = await confirmPayment(tenantId, paymentId, ACTOR);
  assert.deepEqual(result, { status: "INVALID_ORDER_STATE", current: "CANCELLED" });
  const state = await query<any>(
    `SELECT status,confirmed_at,
            EXISTS(SELECT 1 FROM bms_audit_log a
                    WHERE a.tenant_id=$1 AND a.target=$2::text AND a.action='payment.confirm') audited
       FROM bms_payments WHERE tenant_id=$1 AND id=$2::uuid`,
    [tenantId, paymentId]
  );
  assert.equal(state.rows[0].status, "PENDING");
  assert.equal(state.rows[0].confirmed_at, null);
  assert.equal(state.rows[0].audited, false);
});
