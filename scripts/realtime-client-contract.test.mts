import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync(new URL("../apps/web/components/realtime/RealtimeProvider.tsx", import.meta.url), "utf8");
const apollo = readFileSync(new URL("../apps/web/lib/apollo.ts", import.meta.url), "utf8");
const sessionLayer = readFileSync(new URL("../apps/web/app/SessionLayer.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../packages/graphql-core/src/typeDefs.ts", import.meta.url), "utf8");
const resolvers = readFileSync(new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url), "utf8");

test("shared client layer exposes status, bounded dedup and batched invalidation", () => {
  assert.match(provider, /RealtimeProvider/);
  assert.match(provider, /useRealtimeStatus/);
  assert.match(provider, /useRealtimeInvalidation/);
  assert.match(provider, /BoundedEventDeduplicator\(1024\)/);
  assert.match(provider, /pending\.current/);
  assert.match(sessionLayer, /<RealtimeProvider>/);
});

test("reconnect and focus reconcile through the registered authoritative refetch callback", () => {
  assert.match(provider, /connectedOnce/);
  assert.match(provider, /window\.addEventListener\("focus"/);
  assert.match(provider, /document\.addEventListener\("visibilitychange"/);
  assert.match(apollo, /retryWait/);
  assert.match(apollo, /resetRealtimeConnections/);
  assert.doesNotMatch(provider, /refetchQueries\(\{\s*include:\s*["']active["']/);
});

test("generic domain subscription is ticket-scoped and permission-filtered", () => {
  assert.match(schema, /realtimeEvent: RealtimeEvent!/);
  assert.match(resolvers, /REALTIME_EVENT_RULES/);
  assert.match(resolvers, /rule\.permissions\.every/);
  assert.match(resolvers, /claims\.locationIds/);
  assert.match(resolvers, /event\.tenantId !== claims\.tenantId/);
});
