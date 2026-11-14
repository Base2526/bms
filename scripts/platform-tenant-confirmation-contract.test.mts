import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

class FakeGraphQLError extends Error {
  extensions: unknown;
  constructor(message: string, options: { extensions?: unknown } = {}) {
    super(message); this.extensions = options.extensions;
  }
}

test("platform tenant suspension and plan change require explicit confirmation before service writes", async () => {
  const calls: string[] = [];
  let platformAuthorized = true;
  const api = loadWithStubs("apps/web/graphql/bmsSaas.ts", {
    "graphql/error": { GraphQLError: FakeGraphQLError },
    "@/lib/auth": { requireAuth: () => ({ scope: "admin", author_id: "platform-actor" }) },
    "@/lib/db": {}, "@/lib/bms/tenant": {}, "@/lib/bms/permissions": {},
    "@/lib/bms/plans": { changePlan: async () => { calls.push("plan"); return true; } },
    "@/lib/bms/featureAccess": {}, "@/lib/bms/entitlements": {},
    "@/lib/bms/packageMetrics": {}, "@/lib/bms/signup": {}, "@/lib/bms/audit": {},
    "@/lib/bms/platform": {
      requirePlatformAdmin: async () => { if (!platformAuthorized) throw new Error("FORBIDDEN"); },
      setTenantActive: async () => { calls.push("active"); return true; },
    },
    "next/headers": {}, "@/lib/auth/token": {}, "@/lib/auth/adminSession": {},
    "@/lib/auth/rateLimit": {}, "@/lib/bms/socialAuthSettings": {},
  }).bmsSaasResolvers;
  for (const confirm of [false, undefined]) {
    await assert.rejects(api.Mutation.bmsSetTenantActive(null, { tenantId: "tenant-a", active: false, confirm }, {}),
      (error: any) => error.extensions?.code === "CONFIRMATION_REQUIRED");
    await assert.rejects(api.Mutation.bmsSetTenantPlan(null, { tenantId: "tenant-a", planCode: "PRO", confirm }, {}),
      (error: any) => error.extensions?.code === "CONFIRMATION_REQUIRED");
  }
  assert.deepEqual(calls, []);
  assert.equal(await api.Mutation.bmsSetTenantActive(null, { tenantId: "tenant-a", active: false, confirm: true }, {}), true);
  assert.equal(await api.Mutation.bmsSetTenantPlan(null, { tenantId: "tenant-a", planCode: "PRO", confirm: true }, {}), true);
  assert.deepEqual(calls, ["active", "plan"]);
  platformAuthorized = false;
  await assert.rejects(api.Mutation.bmsSetTenantActive(null, { tenantId: "tenant-a", active: true, confirm: true }, {}), /FORBIDDEN/);
  await assert.rejects(api.Mutation.bmsSetTenantPlan(null, { tenantId: "tenant-a", planCode: "FREE", confirm: true }, {}), /FORBIDDEN/);
  assert.deepEqual(calls, ["active", "plan"], "A confirmed but unauthorized request cannot reach either service");
});
