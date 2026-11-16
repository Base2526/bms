import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("order list fetches requested child fields once and denies before reads", async () => {
  const source = readFileSync(path.join(root, "apps/web/graphql/bmsOrders.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const rows = [
    { id: "order-a", customer_id: "customer-a", channel: "web", fulfillment_type: null },
    { id: "order-b", customer_id: null, channel: "shopee", fulfillment_type: null },
  ];
  const calls: string[] = [];
  let denied = false;
  const mocks: Record<string, unknown> = {
    "@/lib/db": { query: async () => { calls.push("list-query"); return { rows }; } },
    "@/lib/bms/orders": {},
    "@/lib/bms/restaurantOrdering": {},
    "@/lib/bms/shipping": { MARKETPLACE_CHANNELS: new Set(["shopee", "lazada"]) },
    "@/lib/bms/membership": {
      listOrderDiscountsBatch: async () => { calls.push("discounts-batch"); return new Map([["order-a", [{ source: "COUPON", label: "test", amount: 2, pointsUsed: 0 }]], ["order-b", []]]); },
    },
    "@/lib/bms/orderListRead": {
      loadOrderListItems: async () => { calls.push("items-batch"); return new Map([["order-a", [{ product_sku: "FAKE-SKU" }]], ["order-b", []]]); },
      loadOrderListShippingAddresses: async () => { calls.push("addresses-batch"); return new Set(["customer-a"]); },
    },
    "@/lib/bms/documents": {},
    "@/lib/bms/permissions": { requirePermission: async () => { if (denied) throw new Error("FORBIDDEN"); } },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-a" },
    "@/lib/bms/audit": {},
    "@/lib/bms/locations": {},
    "@/lib/auth": { requireAuth: () => ({ author_id: "user-a" }) },
    "graphql/error": { GraphQLError: Error },
  };
  new Function("require", "module", "exports", js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const resolvers = module.exports.bmsOrdersResolvers;
  const field = (name: string) => ({ kind: "Field", name: { value: name } });
  const info = {
    fieldNodes: [{ selectionSet: { selections: [field("id"), { kind: "FragmentSpread", name: { value: "Extras" } }] } }],
    fragments: { Extras: { selectionSet: { selections: [field("items"), {
      kind: "InlineFragment", selectionSet: { selections: [field("hasShippingAddress"), field("discountLines")] },
    }] } } },
  };

  const result = await resolvers.Query.bmsOrders(null, { limit: 100 }, {}, info);
  assert.deepEqual(calls.sort(), ["list-query", "items-batch", "addresses-batch", "discounts-batch"].sort());
  assert.deepEqual(await resolvers.BmsOrder.items(result[0], null, {}), [{ product_sku: "FAKE-SKU" }]);
  assert.equal(await resolvers.BmsOrder.hasShippingAddress(result[0], null, {}), true);
  assert.equal(await resolvers.BmsOrder.hasShippingAddress(result[1], null, {}), true);
  assert.deepEqual(await resolvers.BmsOrder.discountLines(result[0], null, {}),
    [{ source: "COUPON", label: "test", amount: 2, pointsUsed: 0 }]);
  assert.equal(calls.length, 4, "field resolvers must use prefetched rows");

  calls.length = 0;
  await resolvers.Query.bmsOrders(null, { limit: 100 }, {}, {
    fieldNodes: [{ selectionSet: { selections: [field("id")] } }], fragments: {},
  });
  assert.deepEqual(calls, ["list-query"], "simple lists must not pay for unused fields");
  calls.length = 0;
  denied = true;
  await assert.rejects(resolvers.Query.bmsOrders(null, {}, {}, info), /FORBIDDEN/);
  assert.deepEqual(calls, []);
});
