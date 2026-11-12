import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function shipmentHarness(fulfillmentType: string | null, orderStatus = "PACKING", auditFails = false) {
  const calls = { sql: [] as Array<{ text: string; params: unknown[] }>, movements: 0, emails: 0, releases: 0 };
  const client = {
    release() { calls.releases++; },
    async query(text: string, params: unknown[] = []) {
      calls.sql.push({ text, params });
      if (text.includes("SELECT status, channel, customer_id, fulfillment_type")) {
        return { rowCount: 1, rows: [{ status: orderStatus, channel: "web", customer_id: "customer", fulfillment_type: fulfillmentType }] };
      }
      if (text === "ROLLBACK" || text === "COMMIT") return { rowCount: 0, rows: [] };
      if (text.includes("FROM bms_customer_addresses")) return { rowCount: 1, rows: [{ one: 1 }] };
      if (text.includes("UPDATE bms_orders") || text.includes("UPDATE bms_inventory")) return { rowCount: 1, rows: [] };
      if (text.includes("INSERT INTO bms_shipments")) return { rowCount: 1, rows: [{ id: "shipment" }] };
      if (text.includes("INSERT INTO bms_audit_log")) {
        if (auditFails) throw new Error("audit failed");
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { getClient: async () => client, query: async () => { throw new Error("Unexpected pool query"); } },
    "./movements": { recordOrderMovements: async () => { calls.movements++; } },
    "./tenant": { beginTenantTx: async () => {} },
    "./orderNotify": { notifyOrderStatusEmail: async () => { calls.emails++; } },
    "./carriers": { getCarrierClient: () => null },
    "./carriers/safeCall": { runCarrierCall: async () => { throw new Error("Unexpected carrier call"); } },
    "./shippingMaster": {
      getMasterCarrier: async () => ({ code: "FLASH" }),
      buildTrackingSnapshot: () => ({ carrierName: "Flash", trackingUrl: null, trackingNoWarning: null }),
    },
    "./carriers/constants": { isCarrier: () => true, CARRIER_CODES: ["FLASH"], CARRIER_LABELS: {} },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/bms/shipping.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name: string) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    }, module, module.exports,
  );
  return { calls, createShipment: module.exports.createShipment as (input: Record<string, unknown>) => Promise<any> };
}

test("carrier shipment rejects pickup before stock, parcel or carrier writes", async () => {
  for (const status of ["PACKING", "SHIPPED"]) {
    const { calls, createShipment } = shipmentHarness("PICKUP", status);
    const result = await createShipment({ tenantId: "tenant", orderId: "order", carrier: "FLASH" });
    assert.equal(result.status, "PICKUP_ORDER");
    assert.equal(calls.movements, 0);
    assert.equal(calls.emails, 0);
    assert.equal(calls.releases, 1);
    assert.equal(calls.sql.length, 2);
    assert.equal(calls.sql[1]?.text, "ROLLBACK");
    assert.deepEqual(calls.sql[0]?.params, ["tenant", "order"]);
  }
});

test("delivery shipment still moves stock once within the requested tenant", async () => {
  const { calls, createShipment } = shipmentHarness("DELIVERY");
  const result = await createShipment({ tenantId: "tenant", orderId: "order", carrier: "FLASH", actor: "cashier" });
  assert.equal(result.status, "CREATED");
  assert.equal(result.orderShipped, true);
  assert.equal(calls.movements, 1);
  assert.equal(calls.emails, 1);
  const stock = calls.sql.find(({ text }) => text.includes("UPDATE bms_inventory"));
  assert.ok(stock);
  assert.match(stock.text, /FROM bms_order_stock_lines WHERE tenant_id = \$2 AND order_id = \$1/);
  assert.match(stock.text, /WHERE inv\.tenant_id = \$2/);
  assert.deepEqual(stock.params, ["order", "tenant"]);
  assert.ok(calls.sql.some(({ text }) => text.includes("INSERT INTO bms_shipments")));
  const audit = calls.sql.find(({ text }) => text.includes("INSERT INTO bms_audit_log"));
  assert.ok(audit);
  assert.deepEqual(audit.params.slice(0, 3), ["tenant", "cashier", "shipment"]);
  assert.deepEqual(JSON.parse(String(audit.params[3])), { orderId: "order", orderShipped: true, carrier: "FLASH" });
  assert.equal(calls.sql.at(-1)?.text, "COMMIT");
});

test("shipment and stock roll back when same-transaction audit fails", async () => {
  const { calls, createShipment } = shipmentHarness("DELIVERY", "PACKING", true);
  await assert.rejects(createShipment({ tenantId: "tenant", orderId: "order", carrier: "FLASH" }), /audit failed/);
  assert.equal(calls.sql.at(-1)?.text, "ROLLBACK");
  assert.ok(!calls.sql.some(({ text }) => text === "COMMIT"));
  assert.equal(calls.emails, 0);
});

test("AI-assisted shipment keeps attribution in the transactional domain audit", async () => {
  const { calls, createShipment } = shipmentHarness("DELIVERY", "SHIPPED");
  const result = await createShipment({ tenantId: "tenant", orderId: "order", carrier: "FLASH",
    actor: "staff", auditVia: "ai:staff" });
  assert.equal(result.status, "CREATED");
  assert.equal(result.orderShipped, false);
  assert.equal(calls.movements, 0);
  const audit = calls.sql.find(({ text }) => text.includes("INSERT INTO bms_audit_log"));
  assert.deepEqual(JSON.parse(String(audit?.params[3])), {
    orderId: "order", orderShipped: false, carrier: "FLASH", via: "ai:staff",
  });
});

test("REST and GraphQL expose a specific pickup refusal", () => {
  const rest = read("apps/web/app/api/bms/shipment/route.ts");
  const graphql = read("apps/web/graphql/bmsShipping.ts");
  const tool = read("apps/web/lib/bms/tools/catalog.ts").split("const createShipmentTool: BmsTool = {")[1]
    .split("const updateTrackingTool: BmsTool = {")[0];
  assert.match(rest, /result\.status === "PICKUP_ORDER" \? 409/);
  assert.match(rest, /actor: String\(auth\.adminId\)/);
  assert.match(graphql, /PICKUP_ORDER: "ออร์เดอร์รับเอง/);
  assert.doesNotMatch(graphql.split("async bmsCreateShipment(")[1].split("async bmsUpdateTracking(")[0], /await audit\(/);
  assert.match(tool, /auditVia: "ai:staff"/);
  assert.doesNotMatch(tool, /auditWrite\(ec, "shipping\.create"/);
});
