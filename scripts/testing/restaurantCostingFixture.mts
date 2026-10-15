import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../../apps/web/lib/db.ts";
import { upsertPosDevice, openPosShift, recordPosSale } from "../../apps/web/lib/bms/pos.ts";
import { createExpenseDocument } from "../../apps/web/lib/bms/expenseDocuments.ts";

/** These tests create fault-injection triggers and disposable fixtures. Never use the dev DB. */
export async function assertCostingTestDatabase() {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.POSTGRES_HOST ?? ""));
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  assert.equal((await query("SELECT current_database() AS name")).rows[0].name, "bms_realtime_test");
}

export async function withCostingFixture(work: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  await assertCostingTestDatabase();
  const tenant = randomUUID();
  let failure: unknown;
  try { await work(await createFixture(tenant)); }
  catch (error) { failure = error; }
  try {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      // Exact UUID only. Delete references before parents; never disable FK/RLS/immutable guards.
      for (const table of [
        "bms_inventory_wastage", "bms_stock_transfers", "bms_purchase_orders", "bms_suppliers",
        "bms_pos_refund_allocations", "bms_pos_return_items", "bms_pos_returns", "bms_tax_documents",
        "bms_payments", "bms_pos_cash_movements", "bms_kitchen_tickets", "bms_order_items",
        "bms_order_discounts", "bms_order_extra_lines", "bms_orders", "bms_pos_expenses",
        "bms_pos_shifts", "bms_pos_devices", "bms_stock_movements", "bms_inventory",
        "bms_branch_prices", "bms_product_recipe_subrecipes", "bms_product_recipes", "bms_products",
        "bms_cost_allocations", "bms_operating_cost_reviews", "bms_expense_documents",
        "bms_delivery_settlements", "bms_delivery_integrations",
        "bms_user_allowed_locations", "bms_role_permissions", "bms_store_profile", "bms_store_capabilities",
        "bms_customers", "bms_locations", "bms_audit_log", "users",
      ]) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      await client.query("DELETE FROM bms_tenants WHERE id=$1", [tenant]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    assert.equal((await query("SELECT id FROM bms_tenants WHERE id=$1", [tenant])).rowCount, 0);
  } catch (error) {
    if (failure) throw new AggregateError([failure, error], "Costing assertion and fixture cleanup both failed");
    throw error;
  }
  if (failure) throw failure;
}

async function createFixture(tenant: string) {
  await query("INSERT INTO bms_tenants(id,name,slug) VALUES ($1,'FAKE costing DB contract',$2)", [tenant, `fake-costing-${tenant}`]);
  await query(`INSERT INTO bms_store_profile(tenant_id,currency,vat_registered,price_includes_vat,vat_rate)
    VALUES ($1,'THB',TRUE,TRUE,7)`, [tenant]);
  const locations: string[] = [];
  for (const code of ["A", "B"]) locations.push((await query(`INSERT INTO bms_locations
    (tenant_id,code,name,branch_code,is_head_office,active) VALUES ($1,$2,$2,$3,$4,TRUE) RETURNING id`,
  [tenant, code, code === "A" ? "00000" : "00001", code === "A"])).rows[0].id);
  const actors: string[] = [];
  for (const label of ["cashier", "approver"]) actors.push((await query(`INSERT INTO users
    (name,username,email,role,role_id,tenant_id,password_hash,fake_test)
    SELECT $2,$2,$2,'Administrator',id,$1,'x',TRUE FROM roles WHERE name='Administrator' ORDER BY id LIMIT 1 RETURNING id`,
  [tenant, `${label}-${tenant}@example.invalid`])).rows[0].id);
  const month = (await query("SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM') AS month")).rows[0].month as string;
  const actor = actors[0], approver = actors[1], location = locations[0];
  const devices = new Map<string, { device: string; shift: string }>();
  const register = async (branch = location) => {
    if (!devices.has(branch)) {
      const device = (await upsertPosDevice(tenant, { locationId: branch, code: `FAKE-${branch}`, active: true })).id;
      const opened = await openPosShift({ tenantId: tenant, deviceId: device, openedBy: actor, openingFloat: 10000 });
      assert.ok(opened.status === "OPENED" || opened.status === "ALREADY_OPEN", JSON.stringify(opened));
      devices.set(branch, { device, shift: opened.shift.id });
    }
    return devices.get(branch)!;
  };
  const product = async (sku: string, cost: number | null = 40, price = 107) => {
    await query(`INSERT INTO bms_products(tenant_id,sku,name,price,cost_price,active,vat_category)
      VALUES ($1,$2,$2,$3,$4,TRUE,'V')`, [tenant, sku, price, cost]);
    for (const surface of ["RETAIL_POS", "RESTAURANT_POS"]) await query(`INSERT INTO bms_product_sales_surfaces
      (tenant_id,product_sku,surface) VALUES ($1,$2,$3)`, [tenant, sku, surface]);
    for (const branch of locations) await query(`INSERT INTO bms_inventory
      (tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES ($1,$2,$3,'BASE',1000,0)`, [tenant, branch, sku]);
  };
  const sale = async (sku: string, qty = 1, branch = location, price = 107) => {
    const reg = await register(branch);
    const result = await recordPosSale({ tenantId: tenant, deviceId: reg.device, shiftId: reg.shift,
      cashierUserId: actor, idempotencyKey: randomUUID(), lines: [{ sku, size: "BASE", packQty: qty }],
      payments: [{ method: "CASH", amount: price * qty, cashTendered: price * qty }] });
    assert.equal(result.status, "SOLD", JSON.stringify(result));
    if (result.status !== "SOLD") throw new Error("Fixture sale failed");
    assert.ok("orderId" in result && typeof result.orderId === "string");
    return { orderId: result.orderId, ...reg };
  };
  const expense = (amount = 10, patch: Partial<Parameters<typeof createExpenseDocument>[2]> = {}) => createExpenseDocument(tenant, actor, {
    locationId: location, category: "RENT", documentKind: "RECEIPT", payeeName: "FAKE supplier",
    documentDate: `${month}-01`, amountBeforeVat: amount, vatAmount: 0, idempotencyKey: randomUUID(), ...patch,
  });
  const ctx = (role = "Administrator") => ({ scope: "admin", admin: { id: actor, tenant_id: tenant, role } });
  return { tenant, actor, approver, location, locations, month, product, sale, register, expense, ctx };
}

/** A tenant-specific trigger proves audit failure rolls back the business write on real PostgreSQL. */
export async function withAuditFailure(tenant: string, action: string, work: () => Promise<void>) {
  await assertCostingTestDatabase();
  const name = `test_cost_audit_${randomUUID().replaceAll("-", "")}`;
  const client = await getClient();
  try {
    await client.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.tenant_id::text = TG_ARGV[0] AND NEW.action = TG_ARGV[1] THEN
        RAISE EXCEPTION 'TEST_COST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
    // Both arguments originate in this fixture; use quote_literal, never user input SQL.
    const quoted = (await client.query("SELECT quote_literal($1) AS tenant,quote_literal($2) AS action", [tenant, action])).rows[0];
    await client.query(`CREATE TRIGGER ${name} BEFORE INSERT ON bms_audit_log FOR EACH ROW
      EXECUTE FUNCTION ${name}(${quoted.tenant},${quoted.action})`);
    try { await work(); }
    finally { await client.query(`DROP TRIGGER ${name} ON bms_audit_log`); }
  } finally {
    try { await client.query(`DROP FUNCTION IF EXISTS ${name}()`); } finally { client.release(); }
  }
}
