import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REALTIME_EVENT_TYPES } from "../packages/realtime/src/events.ts";

const provider = readFileSync(new URL("../apps/web/components/realtime/RealtimeProvider.tsx", import.meta.url), "utf8");
const invalidation = readFileSync(new URL("../apps/web/components/realtime/realtimeInvalidation.ts", import.meta.url), "utf8");
const apollo = readFileSync(new URL("../apps/web/lib/apollo.ts", import.meta.url), "utf8");
const sessionLayer = readFileSync(new URL("../apps/web/app/SessionLayer.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../packages/graphql-core/src/typeDefs.ts", import.meta.url), "utf8");
const resolvers = readFileSync(new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url), "utf8");
const ticketRoute = readFileSync(new URL("../apps/web/app/api/bms/realtime/ticket/route.ts", import.meta.url), "utf8");
const clientProviders = readFileSync(new URL("../apps/web/app/ClientProviders.tsx", import.meta.url), "utf8");
const desktopRenderer = readFileSync(new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url), "utf8");
const posRealtimeCss = readFileSync(new URL("../apps/web/components/realtime/RealtimeProvider.module.css", import.meta.url), "utf8");
const retailPos = readFileSync(new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url), "utf8");
const restaurantPos = readFileSync(new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url), "utf8");
const mobileRealtime = readFileSync(new URL("../apps/mobile/src/lib/realtime.ts", import.meta.url), "utf8");
const mobileRealtimeProvider = readFileSync(new URL("../apps/mobile/src/state/RealtimeContext.tsx", import.meta.url), "utf8");
const mobileGraphqlProvider = readFileSync(new URL("../apps/mobile/src/graphql/BmsGraphqlProvider.tsx", import.meta.url), "utf8");
const mobileStoreModeProvider = readFileSync(new URL("../apps/mobile/src/state/StoreModeContext.tsx", import.meta.url), "utf8");
const mobileLoginScreen = readFileSync(new URL("../apps/mobile/src/screens/LoginScreen.tsx", import.meta.url), "utf8");
const mobileOperations = readFileSync(new URL("../apps/mobile/src/graphql/operations.graphql", import.meta.url), "utf8");
const mobileApp = readFileSync(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("../apps/mobile/src/navigation/MainTabs.tsx", import.meta.url), "utf8");
const mobileRootNavigator = readFileSync(new URL("../apps/mobile/src/navigation/RootNavigator.tsx", import.meta.url), "utf8");

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

test("every operator POS uses one compact connection status instead of a blocking banner", () => {
  assert.match(provider, /export function PosConnectionStatus/);
  assert.match(provider, /pathname === "\/pos\/app"/);
  assert.match(provider, /pathname === "\/pos"/);
  assert.match(provider, /pathname\.startsWith\("\/pos\/restaurant"\)/);
  assert.match(desktopRenderer, /useRealtimeStatus\(\)/);
  assert.match(desktopRenderer, /realtimeStatus === "connected"/);
  assert.match(desktopRenderer, /<PosConnectionStatus apiStatus=\{connection\}/);
  assert.match(restaurantPos, /<PosConnectionStatus\s*\/>/);
  assert.match(retailPos, /!embedded && <PosConnectionStatus\s*\/>/);
  assert.match(provider, /pos_realtime\.fallback/);
  assert.match(provider, /pos_realtime\.fallback_title/);
  assert.match(posRealtimeCss, /\.posConnectionFallback\s*\{[\s\S]*?background:\s*#fffbe6/);
  assert.match(posRealtimeCss, /\.posConnectionPopover\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(provider, /document\.addEventListener\("pointerdown", closeOutside\)/);
});

test("every desktop header popup closes outside, on Escape, and when a sibling opens", () => {
  assert.match(desktopRenderer, /details\[data-desktop-popup\]\[open\]/);
  assert.match(desktopRenderer, /document\.addEventListener\('pointerdown',\s*onPointerDown,\s*true\)/);
  assert.match(desktopRenderer, /event\.key !== 'Escape'/);
  assert.match(desktopRenderer, /document\.addEventListener\('toggle',\s*onToggle,\s*true\)/);
  assert.match(desktopRenderer, /closePopups\(popup\)/);
  assert.equal(
    (desktopRenderer.match(/<details[^>]*data-desktop-popup/g) ?? []).length,
    (desktopRenderer.match(/<details\s/g) ?? []).length,
    "every desktop-shell details popup must opt into the shared dismissal behavior",
  );
});

test("desktop service-call bell refreshes from realtime and keeps bounded polling as fallback", () => {
  assert.match(desktopRenderer, /useRealtimeInvalidation\(\{/);
  assert.match(desktopRenderer, /restaurant\.table_call\.created/);
  assert.match(desktopRenderer, /board_game\.table_call\.created/);
  assert.match(desktopRenderer, /onInvalidate:\s*\(\) => refreshDesktopServiceCalls\(\)/);
  assert.match(desktopRenderer, /debounceMs:\s*0/);
  assert.match(desktopRenderer, /window\.setInterval\(refresh,\s*10_000\)/);
});

test("every realtime event domain has a browser invalidation rule", () => {
  const configured = new Set(
    [...invalidation.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*/gm)].map((match) => match[1]),
  );
  const domains = new Set(REALTIME_EVENT_TYPES.map((type) => type.split(".", 1)[0]));
  assert.deepEqual(
    [...domains].filter((domain) => !configured.has(domain)).sort(),
    [],
    "new event domains must invalidate at least one authoritative browser query",
  );
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
  assert.match(mobileGraphqlProvider, /reportAuthenticationRequired/);
  assert.match(mobileGraphqlProvider, /markAuthenticationRejected\(\)/);
  assert.match(mobileGraphqlProvider, /verify\.kind !== 'REJECTED'/);
  assert.doesNotMatch(mobileGraphqlProvider, /runVerify/);
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
  assert.match(mobileRealtimeProvider, /verify\.kind !== 'REJECTED'/);
  assert.match(mobileStoreModeProvider, /verify\.kind === 'REJECTED'/);
  assert.match(mobileLoginScreen, /verify\.kind === 'REJECTED'/);
  assert.match(mobileApp, /<BmsGraphqlProvider>/);
  assert.match(mobileApp, /<RealtimeProvider>/);
  assert.doesNotMatch(mobileTabs, /<RealtimeProvider>/);
  assert.match(mobileRootNavigator, /verify\.kind === 'REJECTED'/);
  assert.match(mobileRootNavigator, /if \(authenticationRejected\) signOut\(\)/);
  assert.match(mobileRootNavigator, /key=\{authenticationRejected/);
});
