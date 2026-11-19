import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder } from "../apps/web/lib/bms/purchase.ts";

test("supplier package snapshot validates partial receipts, retries, stock movement and RLS", async () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const sku = `FAKE-POUNIT-${randomUUID().slice(0, 8)}`;
  const supplierName = `FAKE supplier ${randomUUID().slice(0, 8)}`;
  const requestId = `po-unit-${randomUUID()}`;
  const user = (await query<{ id: string }>(
    `SELECT id FROM users u WHERE tenant_id=$1 AND NOT EXISTS (
       SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=u.tenant_id AND a.user_id=u.id
     ) ORDER BY id LIMIT 1`, [tenantId]
  )).rows[0];
  assert.ok(user?.id);
  const location = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id=$1 AND active ORDER BY is_head_office DESC,created_at LIMIT 1`, [tenantId]
  )).rows[0];
  assert.ok(location?.id);
  const table = await query<{ name: string | null }>(
    `SELECT to_regclass('bms_purchase_order_items')::text AS name`
  );
  assert.equal(table.rows[0].name, "bms_purchase_order_items");
  let poId = "";
  let scopedBranchId = "";
  try {
    await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
      VALUES ($1,$2,'FAKE cement bag',20,true,'V')`, [tenantId,sku]);
    const line = { sku, size: "STD", qty: 80, unitCost: 12.5,
      supplierUnitName: "pallet", supplierUnitQty: 2, baseQtyPerSupplierUnit: 40,
      conversionEvidence: "FAKE manufacturer pallet label, 40 bags" };
    assert.equal((await createPurchaseOrder({ tenantId, supplierName, requestId,
      items: [{ ...line, qty: 81 }] })).status, "INVALID_INPUT");
    assert.equal((await createPurchaseOrder({ tenantId, supplierName, requestId,
      items: [{ ...line, unitCost: undefined }] })).status, "INVALID_INPUT",
      "unknown converted cost must not become zero");
    assert.equal((await createPurchaseOrder({ tenantId, requestId,
      items: [line] })).status, "INVALID_INPUT", "converted line needs supplier identity");
    assert.equal((await createPurchaseOrder({ tenantId, supplierName,
      items: [line] })).status, "INVALID_INPUT", "converted PO needs a stable request key");

    const created = await createPurchaseOrder({ tenantId, supplierName, requestId, items: [line],
      audit: { actor: user.id } });
    assert.equal(created.status, "CREATED", JSON.stringify(created));
    poId = created.poId;
    assert.equal(created.items[0].qtyOrdered, 80);
    assert.equal(created.items[0].supplierUnitQty, 2);
    const replay = await createPurchaseOrder({ tenantId, supplierName, requestId, items: [line] });
    assert.equal(replay.status, "CREATED");
    assert.equal(replay.poId, poId);
    assert.equal(replay.replayed, true);
    assert.equal((await createPurchaseOrder({ tenantId, supplierName, requestId,
      items: [{ ...line, conversionEvidence: "changed" }] })).status, "IDEMPOTENCY_CONFLICT");
    const read = await getPurchaseOrder(tenantId, poId);
    assert.equal(read?.items[0].baseQtyPerSupplierUnit, 40);
    assert.equal(read?.items[0].conversionEvidence, line.conversionEvidence);

    await assert.rejects(query(`UPDATE bms_purchase_order_items
      SET base_qty_per_supplier_unit=20 WHERE tenant_id=$1 AND po_id=$2`, [tenantId,poId]),
      (error: any) => error.code === "23514");

    const stock = async () => Number((await query<{ qty: number }>(
      `SELECT COALESCE(SUM(current_stock),0)::integer AS qty FROM bms_inventory
        WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]
    )).rows[0].qty);
    const movements = async () => Number((await query<{ qty: number }>(
      `SELECT COALESCE(SUM(qty),0)::integer AS qty FROM bms_stock_movements
        WHERE tenant_id=$1 AND product_sku=$2 AND type='STOCK_IN'`, [tenantId,sku]
    )).rows[0].qty);
    const options = (key: string) => ({ locationId: location.id,
      staffIdempotency: { actorUserId: user.id, key }, audit: { actor: user.id } });
    scopedBranchId = (await query<{ id: string }>(`INSERT INTO bms_locations(tenant_id,code,branch_code,name,active)
      VALUES($1,$2,$3,'FAKE restricted branch',true) RETURNING id`,
      [tenantId,`FAKE-POUNIT-${randomUUID().slice(0,8)}`,randomUUID().slice(0,8)])).rows[0].id;
    await query(`INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id)
      VALUES($1,$2,$3)`, [tenantId,user.id,scopedBranchId]);
    assert.equal((await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 1 }], user.id, user.id,
      options(`branch-${randomUUID()}`))).status, "BRANCH_FORBIDDEN");
    await query(`DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3`,
      [tenantId,user.id,scopedBranchId]);
    await query(`INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id)
      VALUES($1,$2,$3)`, [tenantId,user.id,location.id]);
    assert.equal(await stock(),0);
    assert.equal(await movements(),0);
    const missingKey = await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 1 }], user.id, user.id,
      { locationId: location.id, audit: { actor: user.id } });
    assert.equal(missingKey.status, "INVALID_INPUT");
    assert.equal(missingKey.reasonCode, "IDEMPOTENCY_REQUIRED");
    const wrong = await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 2 }], user.id, user.id, options(`wrong-${randomUUID()}`));
    assert.equal(wrong.status, "INVALID_INPUT");
    assert.equal(wrong.reasonCode, "SUPPLIER_UNIT_MISMATCH");
    assert.equal((await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40 }], user.id, user.id,
      options(`missing-${randomUUID()}`))).status, "INVALID_INPUT");
    assert.equal(await stock(), 0);
    assert.equal(await movements(), 0);

    const firstKey = `receive-${randomUUID()}`;
    const first = await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 1 }], user.id, user.id, options(firstKey));
    assert.equal(first.status, "PARTIAL", JSON.stringify(first));
    assert.equal(await stock(), 40);
    assert.equal(await movements(), 40);
    await query(`DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3`,
      [tenantId,user.id,location.id]);
    const same = await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 1 }], user.id, user.id, options(firstKey));
    assert.equal(same.replayed, true);
    assert.equal(await stock(), 40);
    assert.equal((await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 80, supplierQty: 2 }], user.id, user.id,
      options(firstKey))).status, "IDEMPOTENCY_CONFLICT");
    const second = await receivePurchaseOrder(tenantId, poId,
      [{ sku, size: "STD", qty: 40, supplierQty: 1 }], user.id, user.id,
      options(`receive-${randomUUID()}`));
    assert.equal(second.status, "RECEIVED");
    assert.equal(await stock(), 80);
    assert.equal(await movements(), 80);

    const other = await getClient();
    try {
      await beginTenantTx(other, "22222222-2222-2222-2222-222222222222");
      const hidden = await other.query(`SELECT 1 FROM bms_purchase_order_items WHERE po_id=$1`, [poId]);
      assert.equal(hidden.rowCount, 0);
    } finally { await other.query("ROLLBACK").catch(() => {}); other.release(); }
  } finally {
    await query(`DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3`,
      [tenantId,user.id,location.id]);
    if (scopedBranchId) {
      await query(`DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3`,
        [tenantId,user.id,scopedBranchId]);
      await query(`DELETE FROM bms_locations WHERE tenant_id=$1 AND id=$2`, [tenantId,scopedBranchId]);
    }
    if (poId) {
      await query(`DELETE FROM bms_stock_movements WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
      await query(`DELETE FROM bms_inventory WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
      await query(`DELETE FROM bms_purchase_order_idempotency WHERE tenant_id=$1 AND po_id=$2`, [tenantId,poId]);
      await query(`DELETE FROM bms_purchase_order_items WHERE tenant_id=$1 AND po_id=$2`, [tenantId,poId]);
      await query(`DELETE FROM bms_purchase_orders WHERE tenant_id=$1 AND id=$2`, [tenantId,poId]);
    }
    await query(`DELETE FROM bms_suppliers WHERE tenant_id=$1 AND name=$2`, [tenantId,supplierName]);
    await query(`DELETE FROM bms_products WHERE tenant_id=$1 AND sku=$2`, [tenantId,sku]);
  }
});
