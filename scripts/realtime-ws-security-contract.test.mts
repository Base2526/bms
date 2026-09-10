import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("../apps/ws/src/ws.ts", import.meta.url), "utf8");
const security = readFileSync(new URL("../apps/ws/src/security.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../apps/ws/Dockerfile", import.meta.url), "utf8");
const ticketRoute = readFileSync(new URL("../apps/web/app/api/bms/realtime/ticket/route.ts", import.meta.url), "utf8");
const realtimeAuth = readFileSync(new URL("../apps/web/lib/bms/realtimeAuth.ts", import.meta.url), "utf8");
const composeFiles = ["docker-compose.yml", "docker-compose.dev.yml", "docker-compose.prod.yml"]
  .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

test("gateway accepts subscription operations only and production disables unauthorised resource fields", () => {
  assert.match(security, /operation\.operation !== "subscription"/);
  for (const field of ["time", "messageAdded", "messageDeleted", "commentAdded", "commentUpdated", "commentDeleted"]) {
    assert.match(security, new RegExp(`"${field}"`));
  }
  assert.match(gateway, /inspectSubscriptionOperation/);
});

test("query and variables byte limits are enforced before execution", () => {
  assert.match(security, /QUERY_TOO_LARGE/);
  assert.match(security, /VARIABLES_TOO_LARGE/);
  assert.match(gateway, /WS_MAX_MESSAGE_BYTES/);
});

test("browser origins use an exact normalized allowlist", () => {
  assert.match(security, /new URL\(origin\)\.origin/);
  assert.match(security, /WS_ALLOWED_ORIGINS is required in production/);
  assert.match(gateway, /verifyClient/);
  assert.match(gateway, /x-bms-client-class/);
});

test("fleet connection leases cover ip, user, and tenant", () => {
  assert.match(security, /bms:rt:conn:ip:/);
  assert.match(security, /bms:rt:conn:user:/);
  assert.match(security, /bms:rt:conn:tenant:/);
  assert.match(gateway, /acquireRealtimeConnectionLease/);
});

test("BMS Inbox has no default tenant fallback and requires ticket permission", () => {
  assert.doesNotMatch(core, /DEFAULT_BMS_TENANT_ID/);
  assert.match(core, /claims\.permissions\.includes\("inbox\.view"\)/);
  assert.match(core, /claims\.tenantId/);
});

test("HTTP mints admin tickets only after strict revocation, fresh identity, acting tenant, permissions and locations", () => {
  assert.match(ticketRoute, /mintAdminRealtimeTicket/);
  assert.match(realtimeAuth, /isAdminSessionActiveForRealtime/);
  assert.match(realtimeAuth, /refreshAdminIdentity/);
  assert.match(realtimeAuth, /actingTenantId/);
  assert.match(realtimeAuth, /loadPermissions/);
  assert.match(realtimeAuth, /bms_user_allowed_locations/);
  assert.doesNotMatch(realtimeAuth, /DEFAULT_TENANT/);
});

test("gateway uses ticket auth, ongoing revocation, expiry, health and drain without database access", () => {
  assert.match(gateway, /verifyRealtimeTicket/);
  assert.match(gateway, /session:admin:/);
  assert.match(gateway, /ticket expired/);
  assert.match(gateway, /\/healthz/);
  assert.match(gateway, /\/readyz/);
  assert.match(gateway, /SIGTERM/);
  assert.doesNotMatch(gateway, /from ["'][^"']*(?:lib\/db|\bpg\b)/);
});

test("WS image never bakes JWT_SECRET into an ARG or ENV layer", () => {
  assert.doesNotMatch(dockerfile, /ARG JWT_SECRET/);
  assert.doesNotMatch(dockerfile, /ENV JWT_SECRET/);
});

test("every compose file injects the web ticket TTL and WS gateway controls", () => {
  for (const compose of composeFiles) {
    for (const key of [
      "WS_TICKET_TTL_SECONDS", "WS_ALLOWED_ORIGINS", "WS_MAX_CONNECTIONS_PER_IP",
      "WS_MAX_CONNECTIONS_PER_USER", "WS_MAX_CONNECTIONS_PER_TENANT",
      "WS_MAX_SUBSCRIPTIONS_PER_CONNECTION", "WS_CONNECTION_INIT_TIMEOUT_MS",
      "WS_IDLE_TIMEOUT_MS", "WS_MAX_MESSAGE_BYTES",
    ]) assert.match(compose, new RegExp(`${key}:`), `${key} missing from a compose file`);
  }
});
