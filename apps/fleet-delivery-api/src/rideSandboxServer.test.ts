import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import type { RideSandboxService } from "../../../packages/fleet-delivery-database/src/rideSandbox.js";
import { createRideSandboxServer } from "./rideSandboxServer.js";
import { searchRidePlaces } from "./ridePlaces.js";
import {
  computeDriverPickupEstimate,
  computeRideRoadRoute,
} from "./rideRoutes.js";

test("Google search is consented, bounded, restricted and fails closed without key or provider", async () => {
  const input = { query: "Siam", providerConsent: true };
  await assert.rejects(
    () => searchRidePlaces(input, undefined),
    /GOOGLE_PLACES_NOT_CONFIGURED/,
  );
  await assert.rejects(() =>
    searchRidePlaces({ ...input, providerConsent: false }, "test"),
  );
  let calls = 0;
  const request = (async (url, options) => {
    calls++;
    assert.equal(url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.pageSize, 5);
    assert.equal(body.textQuery, "Siam");
    assert.ok(body.locationRestriction.rectangle);
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "test",
            displayName: { text: "Siam" },
            location: { latitude: 13.7463, longitude: 100.5347 },
          },
          {
            id: "outside",
            displayName: { text: "Outside" },
            location: { latitude: 50, longitude: 0 },
          },
        ],
      }),
    );
  }) as typeof fetch;
  assert.equal(
    (await searchRidePlaces(input, "test", request)).places.length,
    1,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      searchRidePlaces(
        input,
        "test",
        async () => new Response("provider secret", { status: 403 }),
      ),
    /^Error: GOOGLE_PLACES_UNAVAILABLE$/,
  );
  await assert.rejects(
    () => searchRidePlaces(input, "test", async () => new Response("{}bad")),
    /GOOGLE_PLACES_UNAVAILABLE/,
  );
});

test("Google motorcycle routing is explicit, bounded and has no straight-line fallback", async () => {
  const input = {
    pickup: { label: "Siam", lat: 13.7463, lng: 100.5347 },
    dropoff: { label: "Asok", lat: 13.7372, lng: 100.5602 },
    providerConsent: true,
  };
  await assert.rejects(
    () => computeRideRoadRoute(input, undefined),
    /GOOGLE_ROUTES_NOT_CONFIGURED/,
  );
  await assert.rejects(() =>
    computeRideRoadRoute({ ...input, providerConsent: false }, "test"),
  );
  let calls = 0;
  const request = (async (url, options) => {
    calls++;
    assert.equal(
      url,
      "https://routes.googleapis.com/directions/v2:computeRoutes",
    );
    assert.equal(options?.redirect, "error");
    assert.equal(
      (options?.headers as Record<string, string>)["X-Goog-FieldMask"],
      "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.warnings",
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.travelMode, "TWO_WHEELER");
    assert.equal(body.routingPreference, "TRAFFIC_AWARE");
    assert.equal(body.origin.location.latLng.latitude, input.pickup.lat);
    return new Response(
      JSON.stringify({
        routes: [
          {
            distanceMeters: 4500,
            duration: "600.2s",
            polyline: { encodedPolyline: "abcd" },
            warnings: ["Test warning"],
          },
        ],
      }),
    );
  }) as typeof fetch;
  assert.deepEqual(await computeRideRoadRoute(input, "test", request), {
    provider: "GOOGLE",
    travelMode: "TWO_WHEELER",
    distanceM: 4500,
    durationSeconds: 601,
    encodedPolyline: "abcd",
    warnings: ["Test warning"],
  });
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      computeRideRoadRoute(
        input,
        "test",
        async () => new Response("provider secret", { status: 403 }),
      ),
    /GOOGLE_ROUTES_UNAVAILABLE/,
  );
});

test("driver pickup ETA ranks eligible candidates by Google road duration", async () => {
  const origins = [
    { lat: 13.7463, lng: 100.5347 },
    { lat: 13.75, lng: 100.54 },
  ];
  const pickup = { lat: 13.7372, lng: 100.5602 };
  let calls = 0;
  const request = (async (url, options) => {
    calls++;
    assert.equal(
      url,
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    );
    assert.equal(
      (options?.headers as Record<string, string>)["X-Goog-FieldMask"],
      "originIndex,destinationIndex,status,condition,distanceMeters,duration",
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.travelMode, "TWO_WHEELER");
    assert.equal(body.routingPreference, "TRAFFIC_AWARE");
    assert.equal(body.origins.length, 2);
    return new Response(
      JSON.stringify([
        {
          originIndex: 0,
          destinationIndex: 0,
          status: {},
          condition: "ROUTE_EXISTS",
          distanceMeters: 1800,
          duration: "360.2s",
        },
        {
          originIndex: 1,
          destinationIndex: 0,
          status: {},
          condition: "ROUTE_EXISTS",
          distanceMeters: 2200,
          duration: "240s",
        },
      ]),
    );
  }) as typeof fetch;
  assert.deepEqual(
    await computeDriverPickupEstimate(origins, pickup, "test", request),
    { durationSeconds: 240, distanceM: 2200 },
  );
  assert.equal(calls, 1);
  assert.equal(
    await computeDriverPickupEstimate([], pickup, undefined, request),
    null,
  );
  assert.equal(calls, 1);
});

test("ride sandbox refuses production and rate-limit outages before business logic", async () => {
  const previous = process.env.NODE_ENV;
  const service = {} as RideSandboxService;
  const redis = {
    eval: async () => {
      throw new Error("REDIS_DOWN");
    },
  } as unknown as Redis;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => createRideSandboxServer(service, redis),
      /FORBIDDEN_IN_PRODUCTION/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  const server = createRideSandboxServer(service, redis);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      sandbox: true,
      ok: true,
      providers: { placesConfigured: false, routesConfigured: false },
    });
    const rejected = await fetch(`${base}/sandbox/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), {
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    });
    const origin = await fetch(`${base}/sandbox/register`, {
      method: "POST",
      headers: { origin: "https://untrusted.example" },
    });
    assert.equal(origin.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
