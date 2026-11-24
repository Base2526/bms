// =============================================================
// The Pharmacy Intake Lab simulator needs the same permission as its menu entry.
// -------------------------------------------------------------
// bmsPharmacyAssistantTest only called requireAuth(), which any signed-in identity passes,
// including a self-registered public web/Android account. For such a session getTenantId() falls
// back to DEFAULT_TENANT_ID, so the caller could run that shop's pharmacy protocols and sellable
// products through the rule-based simulator. The menu shows the Lab only with
// pharmacy.assessment.read. Found 2026-11-24 (GraphQL sweep).
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

test("only a holder of pharmacy.assessment.read can run the Lab simulator", async () => {
  const runs: string[] = [];
  const resolvers = loadWithStubs("apps/web/graphql/bmsAssistant.ts", {
    "graphql/error": { GraphQLError: FakeGraphQLError },
    "@/lib/auth": { requireAuth: (ctx: any) => { if (!ctx?.user && !ctx?.admin) throw new FakeGraphQLError("Unauthenticated"); return { scope: ctx.admin ? "admin" : "web" }; } },
    "@/lib/bms/permissions": {
      loadPermissions: async (ctx: any) => new Set(ctx?.perms ?? []),
      requirePermission: async (ctx: any, permission: string) => {
        if (!ctx?.admin || !(ctx.perms ?? []).includes(permission)) {
          throw new FakeGraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
        }
      },
    },
    "@/lib/bms/tenant": { getTenantId: (ctx: any) => ctx?.admin?.tenant_id ?? "FAKE-default-tenant" },
    "@/lib/bms/pharmacy/testHarness": {
      runPharmacyTestHarness: async (tenantId: string) => { runs.push(tenantId); return { reply: "FAKE", session: null }; },
    },
    "@/lib/bms/audit": {}, "@/lib/bms/tools/runtime": {}, "@/lib/bms/tools/catalog": {},
    "@/lib/bms/pharmacy/labCheckout": {}, "@/lib/bms/staffAssistantClarification": {},
    "@/lib/bms/boardGameOwnerPolicy": {}, "@/lib/bms/platform": {}, "@/lib/bms/aiProvider": {},
    "@/lib/bms/workAssistantImage": {}, "@/lib/bms/assistantKnowledge": {}, "@/lib/bms/assistantLoyaltyReply": {},
  }).bmsAssistantResolvers;
  const call = (ctx: any) => resolvers.Mutation.bmsPharmacyAssistantTest(null, { message: "FAKE ปวดหัว" }, ctx);

  await assert.rejects(call({ user: { id: "FAKE-public-user" } }), (error: any) => error.extensions?.code === "FORBIDDEN",
    "a public account must not reach the default shop's pharmacy data");
  await assert.rejects(call({ admin: { id: "FAKE-sales", tenant_id: "FAKE-shop" }, perms: ["order.create"] }),
    (error: any) => error.extensions?.code === "FORBIDDEN");
  assert.deepEqual(runs, []);

  await call({ admin: { id: "FAKE-pharmacist", tenant_id: "FAKE-shop" }, perms: ["pharmacy.assessment.read"] });
  assert.deepEqual(runs, ["FAKE-shop"]);
});
