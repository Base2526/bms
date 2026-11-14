import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(failAt?: "wallet" | "audit") {
  const events: string[] = [];
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("SELECT id FROM bms_coupons")) {
      events.push(`lookup:${args[0]}:${args[1]}`);
      return { rows: [{ id: "FAKE-coupon" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO bms_customer_coupon_wallet")) {
      events.push("wallet");
      assert.match(sql, /ON CONFLICT \(tenant_id, customer_id, coupon_id\)/);
      if (failAt === "wallet") throw new Error("FAKE wallet failure");
    }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      events.push("audit");
      if (failAt === "audit") throw new Error("FAKE audit failure");
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") events.push(sql.toLowerCase());
    return { rows: [], rowCount: 1 };
  } };
  const coupons = loadWithStubs("apps/web/lib/bms/coupons.ts", {
    crypto: {}, "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string) => { events.push(`begin:${tenantId}`); } },
    "./customers": {},
  });
  return { coupons, events };
}

test("coupon wallet assignment and audit commit together in tenant transaction", async () => {
  const h = harness();
  assert.equal(await h.coupons.assignCouponToCustomer("FAKE-tenant", "FAKE-customer", " sale5 ",
    { actor: "FAKE-staff" }), true);
  assert.deepEqual(h.events, ["begin:FAKE-tenant", "lookup:FAKE-tenant:SALE5", "wallet", "audit", "commit", "release"]);
});

test("wallet or audit failure rolls the coupon assignment back", async () => {
  for (const failAt of ["wallet", "audit"] as const) {
    const h = harness(failAt);
    await assert.rejects(h.coupons.assignCouponToCustomer("FAKE-tenant", "FAKE-customer", "SALE5"),
      /FAKE .* failure/);
    assert.ok(h.events.includes("rollback"));
    assert.equal(h.events.includes("commit"), false);
  }
});
