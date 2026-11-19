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

const requireAuth = (ctx: any) => ({ scope: "admin", author_id: ctx.admin.id });
const settings = loadWithStubs("apps/web/graphql/tenantSettingsAuth.ts", {
  "graphql/error": { GraphQLError: FakeGraphQLError },
  "@/lib/auth": { requireAuth },
  "@/lib/bms/platform": { isPlatformAdmin: async (ctx: any) => ctx.admin.platform === true },
});

test("store configuration requires Administrator or verified platform status", async () => {
  await assert.rejects(
    settings.requireTenantSettingsAdministrator({ admin: { id: "sales-1", role: "Sales" } }),
    (error: any) => error.extensions?.code === "FORBIDDEN",
  );
  await settings.requireTenantSettingsAdministrator({ admin: { id: "admin-1", role: "Administrator" } });
  await settings.requireTenantSettingsAdministrator({ admin: { id: "platform-1", role: "Sales", platform: true } });
});

test("Sales cannot write channel credentials, AI keys or store identity through GraphQL", async () => {
  const calls: string[] = [];
  const common = {
    "graphql/error": { GraphQLError: FakeGraphQLError },
    "./tenantSettingsAuth": settings,
    "@/lib/auth": { requireAuth },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-1" },
    "@/lib/bms/audit": { audit: async () => {} },
  };
  const channels = loadWithStubs("apps/web/graphql/bmsChannels.ts", {
    ...common,
    "@/lib/db": {}, "@/lib/pubsub": {}, "@/lib/bms/channelHealth": {},
    "@/lib/bms/channels": { upsertChannel: async () => { calls.push("channel"); return true; } },
    "@/lib/bms/platform": { isPlatformAdmin: async () => false },
    "../../../packages/graphql-core/src/bmsInboxSync": {},
    "@/lib/bms/messengerProfile": {},
  }).bmsChannelsResolvers;
  const ai = loadWithStubs("apps/web/graphql/bmsAiConfig.ts", {
    ...common,
    "@/lib/bms/aiConfig": { setTenantAiKey: async () => { calls.push("ai"); return true; } },
    "@/lib/bms/aiUsage": {}, "@/lib/bms/aiProviderHealth": {},
    "@/lib/bms/platform": {}, "@/lib/bms/permissions": {}, "@/lib/bms/aiLimitNotices": {},
  }).bmsAiConfigResolvers;
  const profile = loadWithStubs("apps/web/graphql/bmsStoreProfile.ts", {
    ...common,
    "@/lib/bms/storeProfile": {}, "@/lib/bms/taxDocuments": {},
    "@/lib/bms/platform": { updateTenantIdentity: async () => { calls.push("identity"); return { id: "tenant-1" }; } },
    "@/lib/bms/onboarding": {}, "@/lib/bms/locations": {}, "@/lib/bms/emergencyFacilities": {},
  }).bmsStoreProfileResolvers;
  const sales = { admin: { id: "sales-1", role: "Sales" } };
  await assert.rejects(() => channels.Mutation.bmsUpsertChannel(null, { channel: "line" }, sales));
  await assert.rejects(() => ai.Mutation.bmsSetAiKey(null, { apiKey: "FAKE" }, sales));
  await assert.rejects(() => profile.Mutation.bmsUpdateMyTenant(null, { name: "FAKE" }, sales));
  assert.deepEqual(calls, []);

  const admin = { admin: { id: "admin-1", role: "Administrator" } };
  assert.equal(await channels.Mutation.bmsUpsertChannel(null, { channel: "line" }, admin), true);
  assert.equal(await ai.Mutation.bmsSetAiKey(null, { apiKey: "FAKE" }, admin), true);
  await profile.Mutation.bmsUpdateMyTenant(null, { name: "FAKE" }, admin);
  assert.deepEqual(calls, ["channel", "ai", "identity"]);
});

test("store branding upload routes reject non-Administrators before reading file bytes", async () => {
  for (const routePath of [
    "apps/web/app/api/bms/store-profile/logo/upload/route.ts",
    "apps/web/app/api/bms/store-profile/customer-display-background/upload/route.ts",
  ]) {
    let formReads = 0;
    const route = loadWithStubs(routePath, {
      "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
      "@/lib/bms/adminRouteAuth": { authorizeTenantSettingsAdminRoute: async () => ({ ok: false, status: 403 }) },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
      "@/lib/storage": {},
      "@/lib/bms/storeLogo": {},
    });
    const response = await route.POST({ formData: async () => { formReads++; throw new Error("should not read"); } });
    assert.equal(response.status, 403);
    assert.equal(formReads, 0);
  }
});
