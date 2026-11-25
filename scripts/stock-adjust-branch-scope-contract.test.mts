// =============================================================
// Admin stock adjustment and reorder points respect the actor's branch scope.
// -------------------------------------------------------------
// bmsAdjustStock and bmsSetReorderPoint took locationId from the caller and only checked that it
// belongs to the tenant, so a user restricted to branch A could move or re-threshold stock in
// branch B. Orders, coupons, price tiers and expense documents already call
// userCanAccessLocation(). Found 2026-11-24 (GraphQL sweep).
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import { loadWithStubs } from "./testing/webhookHarness.mts";

class FakeGraphQLError extends Error {
  extensions: unknown;
  constructor(message: string, options: { extensions?: unknown } = {}) {
    super(message);
    this.extensions = options.extensions;
  }
}

function load(calls: string[], allowed: Set<string>) {
  return loadWithStubs("apps/web/graphql/bmsProducts.ts", {
    "graphql/error": { GraphQLError: FakeGraphQLError },
    "@/lib/auth": { requireAuth: (ctx: any) => ({ scope: "admin", author_id: ctx.admin.id }) },
    "@/lib/bms/permissions": { requirePermission: async () => undefined, loadPermissions: async () => new Set(["stock.adjust"]) },
    "@/lib/bms/tenant": { getTenantId: () => "FAKE-tenant" },
    "@/lib/bms/locations": {
      userCanAccessLocation: async (_tenant: string, _user: string, locationId: string) => allowed.has(locationId),
    },
    "@/lib/bms/products": {
      adjustStock: async (...args: unknown[]) => { calls.push(`adjust:${args[7]}`); return { size: "M", current_stock: 1, reserved_stock: 0 }; },
      setReorderPoint: async (...args: unknown[]) => { calls.push(`reorder:${args[5]}`); return { size: "M", current_stock: 1, reserved_stock: 0 }; },
    },
    "@/lib/bms/audit": {}, "@/lib/bms/aiSynonyms": {}, "@/lib/bms/movements": {}, "@/lib/bms/productCategories": {},
    "@/lib/bms/productConfiguration": {}, "@/lib/bms/productImport": {}, "@/lib/bms/productImport.constants": {},
    "@/lib/bms/productStockPolicies": {}, "@/lib/bms/starterMasterData": {}, "@/lib/bms/stock": {},
  }).bmsProductsResolvers;
}

test("a branch-restricted actor cannot adjust stock or reorder points in another branch", async () => {
  const calls: string[] = [];
  const resolvers = load(calls, new Set(["FAKE-branch-A"]));
  const ctx = { admin: { id: "FAKE-manager", tenant_id: "FAKE-tenant" } };
  const base = { sku: "FAKE-SKU", size: "M" };
  await assert.rejects(resolvers.Mutation.bmsAdjustStock(null, { ...base, delta: 5, locationId: "FAKE-branch-B" }, ctx),
    (error: any) => error.extensions?.code === "FORBIDDEN");
  await assert.rejects(resolvers.Mutation.bmsSetReorderPoint(null, { ...base, reorderPoint: 3, locationId: "FAKE-branch-B" }, ctx),
    (error: any) => error.extensions?.code === "FORBIDDEN");
  assert.deepEqual(calls, [], "the stock service must not run for a branch outside the actor's scope");

  await resolvers.Mutation.bmsAdjustStock(null, { ...base, delta: 5, locationId: "FAKE-branch-A" }, ctx);
  await resolvers.Mutation.bmsSetReorderPoint(null, { ...base, reorderPoint: 3, locationId: "FAKE-branch-A" }, ctx);
  assert.deepEqual(calls, ["adjust:FAKE-branch-A", "reorder:FAKE-branch-A"]);
});
