import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync(new URL("../apps/web/components/realtime/RealtimeProvider.tsx", import.meta.url), "utf8");
const invalidation = readFileSync(new URL("../apps/web/components/realtime/realtimeInvalidation.ts", import.meta.url), "utf8");
const apollo = readFileSync(new URL("../apps/web/lib/apollo.ts", import.meta.url), "utf8");
const sessionLayer = readFileSync(new URL("../apps/web/app/SessionLayer.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../packages/graphql-core/src/typeDefs.ts", import.meta.url), "utf8");
const resolvers = readFileSync(new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url), "utf8");
const ticketRoute = readFileSync(new URL("../apps/web/app/api/bms/realtime/ticket/route.ts", import.meta.url), "utf8");
const clientProviders = readFileSync(new URL("../apps/web/app/ClientProviders.tsx", import.meta.url), "utf8");
const mobileRealtime = readFileSync(new URL("../apps/mobile/src/lib/realtime.ts", import.meta.url), "utf8");
const mobileRealtimeProvider = readFileSync(new URL("../apps/mobile/src/state/RealtimeContext.tsx", import.meta.url), "utf8");
const mobileGraphqlProvider = readFileSync(new URL("../apps/mobile/src/graphql/BmsGraphqlProvider.tsx", import.meta.url), "utf8");
const mobileOperations = readFileSync(new URL("../apps/mobile/src/graphql/operations.graphql", import.meta.url), "utf8");
const mobileApp = readFileSync(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("../apps/mobile/src/navigation/MainTabs.tsx", import.meta.url), "utf8");

test("shared client layer exposes status, bounded dedup and batched invalidation", () => {
  assert.match(provider, /RealtimeProvider/);
  assert.match(provider, /useRealtimeStatus/);
  assert.match(provider, /useRealtimeInvalidation/);
  assert.match(provider, /BoundedEventDeduplicator\(1024\)/);
  assert.match(provider, /pending\.current/);
  assert.match(provider, /aggregateVersion <= prior\.version/);
  assert.match(provider, /queryNeedsRealtimeRefetch/);
  assert.match(invalidation, /field\.startsWith\(prefix\)/);
  assert.match(sessionLayer, /<RealtimeProvider>/);
  assert.match(provider, /PosRealtimeProvider/);
  assert.match(clientProviders, /<PosRealtimeProvider>/);
  assert.match(provider, /ADMIN_REALTIME_SUBSCRIPTIONS/);
  assert.match(provider, /POS_REALTIME_SUBSCRIPTIONS/);
  assert.match(ticketRoute, /mintPosRealtimeTicket/);
  assert.match(ticketRoute, /x-pos-device-token/);
});

test("reconnect and focus reconcile through the registered authoritative refetch callback", () => {
  assert.match(provider, /connectedOnce/);
  assert.match(provider, /window\.addEventListener\("focus"/);
  assert.match(provider, /document\.addEventListener\("visibilitychange"/);
  assert.match(apollo, /retryWait/);
  assert.match(apollo, /resetRealtimeConnections/);
  assert.match(provider, /refetchQueries/);
});

test("generic domain subscription is ticket-scoped and permission-filtered", () => {
  assert.match(schema, /realtimeEvent: RealtimeEvent!/);
  // ตัวตัดสินย้ายไป `packages/realtime/src/subscriptionAuth.ts` แล้ว เพื่อให้ทดสอบพฤติกรรมได้
  // (พฤติกรรมจริงถูกตรึงใน `realtime-subscription-auth-contract`) · ที่นี่ตรึงแค่ว่า resolver
  // ยังเรียกตัวกลางตัวนั้น ไม่ได้แอบมีตัวตัดสินชุดที่สองในไฟล์ resolver
  assert.match(resolvers, /canReceiveRealtimeEvent/);
  assert.match(resolvers, /realtimeTopics\(requireRealtimeClaims\(ctx\)\)/);
  assert.doesNotMatch(
    resolvers,
    /rule\.permissions\.every/,
    "resolver ต้องไม่ถือสำเนาของกฎสิทธิ์เอง",
  );
  const auth = readFileSync(
    new URL("../packages/realtime/src/subscriptionAuth.ts", import.meta.url),
    "utf8",
  );
  assert.match(auth, /REALTIME_EVENT_RULES/);
  assert.match(auth, /rule\.permissions\.every/);
  assert.match(auth, /claims\.locationIds/);
  assert.match(auth, /event\.tenantId !== claims\.tenantId/);
  assert.match(auth, /claims\.scope === "pos" && event\.deviceId === claims\.subjectId/);
});

test("POS realtime caller uses named domain subscriptions instead of the generic stream", () => {
  assert.match(provider, /subscription PosDeviceSessionChanged/);
  assert.match(provider, /subscription PosShiftChanged/);
  assert.match(provider, /subscription PosOrderChanged/);
  assert.match(provider, /subscription PosRestaurantCheckChanged/);
  assert.match(provider, /subscription PosKitchenTicketChanged/);
  assert.match(provider, /subscription PosMenuAvailabilityChanged/);
  assert.match(provider, /subscription PosQrOrderChanged/);
  assert.match(provider, /subscription PosIncomingOrderChanged/);
  assert.match(provider, /subscription PosInventoryChanged/);
  assert.match(provider, /subscription PosPaymentChanged/);
  assert.match(provider, /subscription PosBmsOrderChanged/);
  assert.match(provider, /fieldName: "bmsDeviceSessionChanged"/);
  assert.match(provider, /fieldName: "bmsKitchenTicketChanged"/);
  assert.match(provider, /fieldName: "bmsOrderChanged"/);
  assert.match(provider, /subscriptions=\{POS_REALTIME_SUBSCRIPTIONS\}/);
  assert.match(provider, /subscriptions=\{ADMIN_REALTIME_SUBSCRIPTIONS\}/);
});

test("React Native POS uses generated operations through Apollo and graphql-ws", () => {
  assert.match(mobileRealtime, /realtimeTicketUrl/);
  assert.match(mobileRealtime, /scope=pos/);
  assert.match(mobileRealtime, /realtimeWsUrl/);
  assert.match(mobileGraphqlProvider, /new GraphQLWsLink/);
  assert.match(mobileGraphqlProvider, /createClient/);
  assert.match(mobileGraphqlProvider, /nativeWebSocketOptions/);
  assert.match(mobileRealtime, /'x-bms-client-class': 'native'/);
  assert.match(mobileGraphqlProvider, /retryAttempts: Infinity/);
  assert.match(mobileGraphqlProvider, /reconnectDelayMs/);
  assert.match(mobileGraphqlProvider, /authorization: target \? `Bearer/);
  assert.match(mobileOperations, /query PosBootstrap/);
  assert.match(mobileOperations, /mutation VerifyPosCashier/);
  assert.match(mobileOperations, /subscription MobileDeviceSessionChanged/);
  assert.match(mobileOperations, /subscription MobileKitchenTicketChanged/);
  assert.match(mobileOperations, /subscription MobileOrderChanged/);
  assert.match(mobileRealtimeProvider, /useSubscription/);
  assert.match(mobileRealtimeProvider, /client\.refetchQueries/);
  assert.match(mobileRealtimeProvider, /AppState\.addEventListener/);
  assert.match(mobileRealtimeProvider, /realtimeStatus === 'connected'\) reconcile\(\)/);
  assert.match(mobileRealtimeProvider, /DEGRADED_RECONCILE_MS/);
  assert.match(mobileRealtimeProvider, /BASE_SUBSCRIPTIONS/);
  assert.match(mobileRealtimeProvider, /RESTAURANT_SUBSCRIPTIONS/);
  assert.match(mobileApp, /<BmsGraphqlProvider>/);
  assert.match(mobileApp, /<RealtimeProvider>/);
  assert.doesNotMatch(mobileTabs, /<RealtimeProvider>/);
});
