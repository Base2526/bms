import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  runMigrations,
  withTenantTransaction,
} from "@bms/fleet-delivery-database";
import { createRedisClient } from "@bms/fleet-delivery-shared";
import { RideSandboxService } from "../../../packages/fleet-delivery-database/src/rideSandbox.js";
import { createRideSandboxServer } from "./rideSandboxServer.js";

const url = process.env.FLEET_DELIVERY_TEST_DATABASE_URL;
const redisUrl = process.env.FLEET_DELIVERY_TEST_REDIS_URL;
test(
  "passenger sandbox: signup, two drivers race, pickup, ride, declined/retried payment, recovery and isolation",
  { skip: !url || !redisUrl },
  async () => {
    const parsed = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(parsed.hostname),
      "Only local test DB allowed",
    );
    const owner = createDatabasePool(url!);
    await runMigrations(owner, "packages/fleet-delivery-database/migrations");
    assert.deepEqual(
      await runMigrations(owner, "packages/fleet-delivery-database/migrations"),
      [],
    );
    parsed.searchParams.set("options", "-c role=fleet_delivery_app");
    const app = createDatabasePool(parsed.toString(), 10);
    const redis = createRedisClient(redisUrl!);
    await redis.connect();
    const tenant = `sandbox:ride-test:${randomUUID()}`;
    const service = new RideSandboxService(app, tenant);
    const server = createRideSandboxServer(service, redis, {
      routesKey: "integration-test",
      request: async (providerUrl) =>
        new Response(
          JSON.stringify(
            String(providerUrl).includes("computeRouteMatrix")
              ? [
                  {
                    originIndex: 0,
                    destinationIndex: 0,
                    status: {},
                    condition: "ROUTE_EXISTS",
                    distanceMeters: 900,
                    duration: "240s",
                  },
                ]
              : {
                  routes: [
                    {
                      distanceMeters: 3100,
                      duration: "540s",
                      polyline: { encodedPolyline: "abcd" },
                      warnings: [],
                    },
                  ],
                },
          ),
        ),
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    assert.ok(addr && typeof addr !== "string");
    const origin = `http://127.0.0.1:${addr.port}`;
    const request = async (
      path: string,
      token = "",
      body?: unknown,
      key = randomUUID(),
    ) => {
      const res = await fetch(`${origin}/sandbox/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, data: (await res.json()) as any };
    };
    try {
      const register = async (username: string, role: string) => {
        const res = await request("register", "", {
          username,
          password: "sandbox-pass-123",
          role,
          displayName: username,
          vehiclePlate: role === "DRIVER" ? "TEST-001" : "",
          sandboxConsent: true,
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        return res.data.accessToken as string;
      };
      const rider = await register("rider.test", "RIDER");
      const stranger = await register("other.test", "RIDER");
      const d1 = await register("driver.one", "DRIVER"),
        d2 = await register("driver.two", "DRIVER");
      assert.equal((await request("snapshot")).status, 401);
      assert.equal(
        (
          await request("login", "", {
            username: "unknown",
            password: "sandbox-pass-123",
            role: "RIDER",
          })
        ).status,
        401,
      );
      const normalized = await request("login", "", {
        username: " RIDER.TEST ",
        password: "sandbox-pass-123",
        role: "RIDER",
      });
      assert.equal(normalized.status, 200);
      assert.equal(
        (await request("availability", rider, { online: true })).status,
        403,
      );
      await request("availability", d1, { online: true });
      await request("availability", d2, { online: true });
      const point = { label: "Siam", lat: 13.7463, lng: 100.5347 };
      const fix = (lat = point.lat, lng = point.lng) => ({
        lat,
        lng,
        accuracyM: 15,
        capturedAt: new Date().toISOString(),
        source: "SIMULATOR",
      });
      assert.equal((await request("nearby", rider, point)).data.count, 0);
      assert.equal((await request("location", rider, fix())).status, 403);
      assert.equal(
        (await request("location", d1, { ...fix(), source: "GPS" })).status,
        422,
      );
      assert.equal(
        (await request("location", d1, { ...fix(), accuracyM: 101 })).status,
        422,
      );
      assert.equal(
        (
          await request("location", d1, {
            ...fix(),
            capturedAt: new Date(Date.now() - 61000).toISOString(),
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request("location", d1, {
            ...fix(),
            capturedAt: new Date(Date.now() + 11000).toISOString(),
          })
        ).status,
        422,
      );
      assert.equal((await request("location", d1, fix())).status, 200);
      assert.equal((await request("location", d2, fix(14, 101))).status, 200);
      assert.deepEqual((await request("nearby", rider, point)).data, {
        assessedDriverCount: 1,
        count: 1,
        etaProvider: "GOOGLE",
        nearestDistanceM: 0,
        pickupEtaSeconds: 240,
        pickupEtaStatus: "AVAILABLE",
        pickupRoadDistanceM: 900,
        radiusM: 5000,
      });
      assert.equal((await request("nearby", d1, point)).status, 403);
      assert.equal(
        (await request("snapshot", stranger)).data.driverLocation,
        null,
      );
      assert.equal(
        (
          await request("places", stranger, {
            query: "Siam",
            providerConsent: true,
          })
        ).data.error.code,
        "GOOGLE_PLACES_NOT_CONFIGURED",
      );
      const quote = await request("quotes", rider, {
        pickup: { label: "Siam test", lat: 13.7463, lng: 100.5347 },
        dropoff: { label: "Asok test", lat: 13.7372, lng: 100.5602 },
        providerConsent: true,
      });
      assert.equal(quote.status, 200);
      assert.equal(quote.data.distanceM, 3100);
      assert.equal(quote.data.fareSatang, 5200);
      assert.equal(quote.data.pricing, "SANDBOX_GOOGLE_ROAD_V1");
      assert.equal(quote.data.route.travelMode, "TWO_WHEELER");
      assert.equal(
        (
          await request("trips", stranger, {
            quoteId: quote.data.id,
            confirmed: true,
          })
        ).status,
        404,
      );
      const creationKey = randomUUID(),
        creation = { quoteId: quote.data.id, confirmed: true };
      const trip = await request("trips", rider, creation, creationKey);
      assert.equal(trip.status, 200);
      assert.equal(trip.data.state, "SEARCHING");
      assert.deepEqual(
        (await request("trips", rider, creation, creationKey)).data,
        trip.data,
      );
      assert.equal(
        (
          await request(
            "trips",
            rider,
            { ...creation, quoteId: randomUUID() },
            creationKey,
          )
        ).status,
        409,
      );
      const id = trip.data.id;
      const command = async (
        token: string,
        action: string,
        version: number,
        extra = {},
        key = randomUUID(),
      ) =>
        request(
          `trips/${id}`,
          token,
          { action, version, confirmed: true, ...extra },
          key,
        );
      assert.equal(
        (await command(rider, "pay", 1, { paymentOutcome: "SUCCEEDED" }))
          .status,
        409,
      );
      assert.equal((await command(stranger, "cancel", 1)).status, 404);
      assert.equal((await request("snapshot", d1)).data.offers.length, 1);
      assert.equal((await request("snapshot", d2)).data.offers.length, 0);
      assert.equal(
        (await command(d2, "accept", 1)).data.error.code,
        "FRESH_NEARBY_LOCATION_REQUIRED",
      );
      await owner.query(
        "UPDATE fleet_delivery.ride_sandbox_accounts SET location_received_at=now()-interval '61 seconds' WHERE tenant_ref=$1 AND username='driver.one'",
        [tenant],
      );
      assert.equal((await request("nearby", rider, point)).data.count, 0);
      assert.equal(
        (await command(d1, "accept", 1)).data.error.code,
        "FRESH_NEARBY_LOCATION_REQUIRED",
      );
      await service.purgeLocations();
      assert.equal((await request("snapshot", d1)).data.driverLocation, null);
      assert.equal((await request("location", d1, fix())).status, 200);
      assert.equal((await request("location", d2, fix())).status, 200);
      const race = await Promise.all([
        command(d1, "accept", 1),
        command(d2, "accept", 1),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      const driver = race[0]!.status === 200 ? d1 : d2,
        loser = driver === d1 ? d2 : d1;
      assert.equal((await request("nearby", rider, point)).data.count, 1);
      assert.ok((await request("snapshot", rider)).data.driverLocation);
      assert.equal(
        (await request("snapshot", stranger)).data.driverLocation,
        null,
      );
      await request("availability", loser, { online: false });
      assert.equal(
        (await request("snapshot", loser)).data.driverLocation,
        null,
      );
      assert.equal(
        (await request("location", loser, fix())).data.error.code,
        "DRIVER_OFFLINE",
      );
      assert.equal((await request("nearby", rider, point)).data.count, 0);
      assert.equal((await command(loser, "arrive", 2)).status, 404);
      assert.equal((await command(rider, "arrive", 2)).status, 403);
      assert.equal((await command(driver, "finish", 2)).status, 409);
      assert.equal((await command(driver, "arrive", 1)).status, 409);
      assert.equal(
        (await command(driver, "arrive", 2)).data.state,
        "AT_PICKUP",
      );
      assert.equal(
        (await command(driver, "start", 3)).data.state,
        "IN_PROGRESS",
      );
      assert.equal((await command(rider, "cancel", 4)).status, 409);
      const freshProcess = new RideSandboxService(app, tenant);
      assert.equal(
        (await freshProcess.snapshot(rider)).current?.state,
        "IN_PROGRESS",
      );
      assert.equal(
        (await command(driver, "finish", 4)).data.state,
        "AWAITING_PAYMENT",
      );
      assert.equal(
        (await command(driver, "pay", 5, { paymentOutcome: "SUCCEEDED" }))
          .status,
        403,
      );
      const declined = await command(rider, "pay", 5, {
        paymentOutcome: "DECLINED",
      });
      assert.equal(declined.data.paymentStatus, "DECLINED");
      assert.equal(declined.data.state, "AWAITING_PAYMENT");
      const payKey = randomUUID();
      const paid = await command(
        rider,
        "pay",
        6,
        { paymentOutcome: "SUCCEEDED" },
        payKey,
      );
      assert.equal(paid.data.state, "COMPLETED");
      assert.ok(paid.data.receiptRef.startsWith("sandbox:"));
      assert.deepEqual(
        (
          await command(
            rider,
            "pay",
            6,
            { paymentOutcome: "SUCCEEDED" },
            payKey,
          )
        ).data,
        paid.data,
      );
      assert.equal(
        (await command(rider, "pay", 7, { paymentOutcome: "SUCCEEDED" }))
          .status,
        409,
      );
      const snapshot = await request("snapshot", driver);
      assert.equal(snapshot.data.earningsSatang, quote.data.fareSatang);
      assert.equal(snapshot.data.current, null);
      assert.equal(snapshot.data.history.length, 1);
      assert.equal(
        (await request("snapshot", rider)).data.driverLocation,
        null,
      );
      assert.equal(
        (await request("snapshot", stranger)).data.history.length,
        0,
      );
      await assert.rejects(
        () => new RideSandboxService(app, `${tenant}:other`).snapshot(rider),
        /SESSION_EXPIRED/,
      );
      const noScope = await app.query(
        "SELECT id FROM fleet_delivery.ride_sandbox_accounts WHERE tenant_ref=$1",
        [tenant],
      );
      assert.equal(noScope.rowCount, 0);
      await withTenantTransaction(app, `${tenant}:other`, async (c) =>
        assert.equal(
          (
            await c.query(
              "SELECT id FROM fleet_delivery.ride_sandbox_trips WHERE tenant_ref=$1",
              [tenant],
            )
          ).rowCount,
          0,
        ),
      );
      const audit = await owner.query(
        "SELECT count(*)::int AS n FROM fleet_delivery.ride_sandbox_audit WHERE tenant_ref=$1 AND action='sandbox.payment.succeeded'",
        [tenant],
      );
      assert.equal(audit.rows[0].n, 1);
      const quote2 = await request("quotes", rider, {
        pickup: { label: "Siam", lat: 13.7463, lng: 100.5347 },
        dropoff: { label: "Asok", lat: 13.7372, lng: 100.5602 },
        providerConsent: true,
      });
      const trip2 = await request("trips", rider, {
        quoteId: quote2.data.id,
        confirmed: true,
      });
      const cancelled = await request(`trips/${trip2.data.id}`, rider, {
        action: "cancel",
        version: 1,
        confirmed: true,
      });
      assert.equal(cancelled.data.state, "CANCELLED");
      await request("logout", rider, {});
      assert.equal((await request("snapshot", rider)).status, 401);
      const originDenied = await fetch(`${origin}/sandbox/register`, {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      });
      assert.equal(originDenied.status, 403);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await redis.quit();
      await app.end();
      for (const table of [
        "audit",
        "commands",
        "trips",
        "quotes",
        "sessions",
        "accounts",
      ]) {
        await owner.query(
          `DELETE FROM fleet_delivery.ride_sandbox_${table} WHERE tenant_ref=$1`,
          [tenant],
        );
      }
      await owner.end();
    }
  },
);
