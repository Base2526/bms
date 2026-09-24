// =============================================================
// Back-office tax-document guards — DB contract (dev DB only)
// -------------------------------------------------------------
// Every fixture belongs to this suite's tenant and is removed at teardown.
//
//   node scripts/run-contract-tests.mjs db tax-backoffice-guards
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { getClient, query } from "../apps/web/lib/db.ts";
import { cancelOrderInTx, returnOrder } from "../apps/web/lib/bms/orders.ts";
import { refundPayment } from "../apps/web/lib/bms/payments.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";

const TAG = "tax-backoffice-guards-test";
let tenantId = "";
let locationId = "";
let sequence = 0;

async function newOrder(status: "PENDING" | "COMPLETED"): Promise<string> {
  return (await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, channel, customer_ref, status, total_amount, location_id)
     VALUES ($1,'pos',$2,$3,107,$4) RETURNING id`,
    [tenantId, `fake-${TAG}`, status, locationId]
  )).rows[0].id;
}

async function addActiveTaxDocument(orderId: string): Promise<void> {
  sequence += 1;
  await query(
    `INSERT INTO bms_tax_documents
       (tenant_id, location_id, order_id, doc_type, doc_no, issue_date,
        taxable_amount, vat_amount, grand_total, vat_rate)
     VALUES ($1,$2,$3,'ABBREVIATED',$4,
             (now() AT TIME ZONE 'Asia/Bangkok')::date,107,7,107,7)`,
    [tenantId, locationId, orderId, `FAKE-GUARD-${process.pid}-${sequence}`]
  );
}

async function addConfirmedPayment(orderId: string): Promise<string> {
  return (await query<{ id: string }>(
    `INSERT INTO bms_payments (tenant_id, order_id, method, amount, status)
     VALUES ($1,$2,'CASH',107,'CONFIRMED') RETURNING id`,
    [tenantId, orderId]
  )).rows[0].id;
}

async function cancelInTenantTx(orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await cancelOrderInTx(client, tenantId, orderId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test("setup: isolated tenant", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, vat_registered, price_includes_vat)
     VALUES ($1,TRUE,TRUE)`,
    [tenantId]
  );
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'MAIN','FAKE HQ','00000',TRUE,TRUE) RETURNING id`,
    [tenantId]
  )).rows[0].id;
});

test("returnOrder rejects an active tax document and still permits a document-free return", async () => {
  const guarded = await newOrder("COMPLETED");
  await addActiveTaxDocument(guarded);
  await assert.rejects(() => returnOrder(tenantId, guarded), /คืนผ่านหน้า POS เพื่อออกใบลดหนี้/);
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId, guarded]
  )).rows[0].status, "COMPLETED");

  const plain = await newOrder("COMPLETED");
  assert.equal(await returnOrder(tenantId, plain), true);
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId, plain]
  )).rows[0].status, "RETURNED");
});

test("cancelOrderInTx rejects an active tax document and still permits a document-free reservation", async () => {
  const guarded = await newOrder("PENDING");
  await addActiveTaxDocument(guarded);
  await assert.rejects(() => cancelInTenantTx(guarded), /คืนผ่านหน้า POS เพื่อออกใบลดหนี้/);
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId, guarded]
  )).rows[0].status, "PENDING");

  const plain = await newOrder("PENDING");
  assert.equal(await cancelInTenantTx(plain), true);
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId, plain]
  )).rows[0].status, "CANCELLED");
});

test("refundPayment rejects an active tax document and still permits a document-free refund", async () => {
  const guardedOrder = await newOrder("COMPLETED");
  await addActiveTaxDocument(guardedOrder);
  const guardedPayment = await addConfirmedPayment(guardedOrder);
  await assert.rejects(
    () => refundPayment(tenantId, guardedPayment, "fake-actor"),
    /คืนผ่านหน้า POS เพื่อออกใบลดหนี้/
  );
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_payments WHERE tenant_id=$1 AND id=$2`, [tenantId, guardedPayment]
  )).rows[0].status, "CONFIRMED");

  const plainOrder = await newOrder("COMPLETED");
  const plainPayment = await addConfirmedPayment(plainOrder);
  assert.equal(await refundPayment(tenantId, plainPayment, "fake-actor"), true);
  assert.equal((await query<{ status: string }>(
    `SELECT status FROM bms_payments WHERE tenant_id=$1 AND id=$2`, [tenantId, plainPayment]
  )).rows[0].status, "REFUNDED");
});

test("teardown", async () => {
  if (!tenantId) return;
  for (const table of [
    "bms_audit_log", "bms_payments", "bms_tax_documents", "bms_document_counters",
    "bms_order_items", "bms_orders", "bms_locations", "bms_store_profile",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
  const left = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  assert.equal(left.rows[0].n, 0);
});
