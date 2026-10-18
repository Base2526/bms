import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  advanceDispatchAttempt,
  claimDispatchAttempts,
  createDatabasePool,
  isServiceTokenRevoked,
} from "@bms/fleet-delivery-database";
import { createRedisClient } from "@bms/fleet-delivery-shared";
import { createFleetDeliveryServer } from "./server.js";
import { createServiceTokenVerifier } from "./serviceAuth.js";

const databaseUrl = process.env.FLEET_DELIVERY_TEST_DATABASE_URL?.trim();
const redisUrl = process.env.FLEET_DELIVERY_TEST_REDIS_URL?.trim();

async function createReadyDelivery(
  ownerPool: ReturnType<typeof createDatabasePool>,
  tenantRef: string,
  branchRef: string,
): Promise<{ id: string; version: number }> {
  const contextId = randomUUID();
  const quoteId = randomUUID();
  const deliveryId = randomUUID();
  const orderRef = `order:${randomUUID()}`;
  await ownerPool.query(
    `INSERT INTO fleet_delivery.order_context_snapshots (
       id, tenant_ref, branch_ref, bms_order_ref, order_version, fulfillment_type,
       payment_state, merchant_readiness, eligibility_version, eligibility_decision,
       eligibility_blockers, eligibility_evaluated_at, dropoff_point, geocode_confidence,
       route_provider, route_reference, route_distance_m, route_observed_at, source_message_id
     ) VALUES (
       $1,$2,$3,$4,1,'DELIVERY','CONFIRMED','READY','phase3:v1','ELIGIBLE','[]'::jsonb,now(),
       ST_SetSRID(ST_MakePoint(100.51,13.76),4326),0.999,'synthetic',$5,1000,now(),$6
     )`,
    [contextId, tenantRef, branchRef, orderRef, `route:${randomUUID()}`, randomUUID()],
  );
  await ownerPool.query(
    `INSERT INTO fleet_delivery.delivery_quotes (
       id, tenant_ref, branch_ref, bms_order_ref, order_context_id, order_version,
       eligibility_version, configuration_version, pricing_rule_version, route_provider,
       route_reference, route_distance_m, billable_distance_m, currency, base_fare_satang,
       distance_charge_satang, gross_delivery_fee_satang, customer_contribution_satang,
       merchant_subsidy_satang, explicit_discount_satang, eligible_commission_fee_satang,
       commission_bps, commission_satang, distance_rounding, commission_rounding,
       status, created_by, expires_at, bound_at
     ) VALUES (
       $1,$2,$3,$4,$5,1,'phase3:v1',1,'phase3:v1','synthetic',$6,1000,1000,'THB',
       1000,1000,2000,1500,500,0,2000,500,100,'STARTED_KILOMETRE','HALF_UP_SATANG',
       'BOUND','phase3-fixture',now()+interval '1 hour',now()
     )`,
    [quoteId, tenantRef, branchRef, orderRef, contextId, `route:${randomUUID()}`],
  );
  await ownerPool.query(
    `INSERT INTO fleet_delivery.deliveries (
       id, tenant_ref, branch_ref, bms_order_ref, quote_id, state, version, currency,
       gross_delivery_fee_satang, customer_contribution_satang, merchant_subsidy_satang,
       explicit_discount_satang, commission_bps, commission_satang, created_by
     ) VALUES ($1,$2,$3,$4,$5,'READY_FOR_DISPATCH',4,'THB',2000,1500,500,0,500,100,'phase3-fixture')`,
    [deliveryId, tenantRef, branchRef, orderRef, quoteId],
  );
  return { id: deliveryId, version: 4 };
}

test("phase 3 dispatch is tenant-safe, evidence-backed, atomic and recoverable", {
  skip: !databaseUrl || !redisUrl,
}, async () => {
  const ownerPool = createDatabasePool(databaseUrl!, 6);
  const appUrl = new URL(databaseUrl!);
  appUrl.searchParams.set("options", "-c role=fleet_delivery_app");
  const appPool = createDatabasePool(appUrl.toString(), 24);
  const workerUrl = new URL(databaseUrl!);
  workerUrl.searchParams.set("options", "-c role=fleet_delivery_worker");
  const workerPool = createDatabasePool(workerUrl.toString(), 4);
  const redis = createRedisClient(redisUrl!);
  const adminPrincipal = `phase3-dispatch-${randomUUID()}`;
  const driverAPrincipal = `phase3-driver-a-${randomUUID()}`;
  const driverBPrincipal = `phase3-driver-b-${randomUUID()}`;
  const tenantRef = `tenant:phase3-${randomUUID()}`;
  const branchRef = "branch:main";
  await redis.connect();
  await ownerPool.query(
    `INSERT INTO fleet_delivery.integration_mappings (
       principal_subject, external_tenant_ref, external_branch_ref, allowed_producer
     ) VALUES ($1,$2,$3,'synthetic-test')`,
    [adminPrincipal, tenantRef, branchRef],
  );
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "phase3-test-key";
  publicJwk.alg = "EdDSA";
  const sign = (subject: string, scopes: string[]) => new SignJWT({ scopes })
    .setProtectedHeader({ alg: "EdDSA", kid: "phase3-test-key" })
    .setIssuer("synthetic-phase3")
    .setAudience("fleet-delivery")
    .setSubject(subject)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const [adminToken, driverAToken, driverBToken] = await Promise.all([
    sign(adminPrincipal, ["dispatch.manage"]),
    sign(driverAPrincipal, ["driver.availability.write", "driver.location.write", "driver.offers.read", "driver.offers.decide", "driver.assignments.read", "driver.journey.write", "driver.snapshot.read"]),
    sign(driverBPrincipal, ["driver.availability.write", "driver.location.write", "driver.offers.read", "driver.offers.decide", "driver.assignments.read", "driver.journey.write", "driver.snapshot.read"]),
  ]);
  const server = createFleetDeliveryServer({
    pool: appPool,
    redis,
    verifyServiceToken: createServiceTokenVerifier({
      jwks: { keys: [publicJwk] },
      issuer: "synthetic-phase3",
      audience: "fleet-delivery",
      isRevoked: (claims) => isServiceTokenRevoked(appPool, claims),
    }),
    maxBodyBytes: 65_536,
    serviceRateLimitPerMinute: 10_000,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (token: string, path: string, method: string, body: unknown, key: string) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    const getOffers = (token: string, tenant = tenantRef) => fetch(
      `${baseUrl}/v1/driver/offers?tenantRef=${encodeURIComponent(tenant)}&branchRef=${encodeURIComponent(branchRef)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const getCurrentAssignment = (token: string, tenant = tenantRef) => fetch(
      `${baseUrl}/v1/driver/assignments/current?tenantRef=${encodeURIComponent(tenant)}&branchRef=${encodeURIComponent(branchRef)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const getSnapshot = (token: string, tenant = tenantRef) => fetch(
      `${baseUrl}/v1/driver/snapshot?tenantRef=${encodeURIComponent(tenant)}&branchRef=${encodeURIComponent(branchRef)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const claimExpected = async (attemptId: string, workerId: string, leaseSeconds = 30) => {
      for (let tryNumber = 0; tryNumber < 5; tryNumber += 1) {
        const attempts = await claimDispatchAttempts(workerPool, workerId, 100, leaseSeconds);
        if (attempts.some((item) => item.id === attemptId)) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(`dispatch attempt ${attemptId} was not claimable by ${workerId}`);
    };
    const policy = {
      tenantRef, branchRef, version: 1,
      pickup: { longitude: 100.5, latitude: 13.75 },
      initialRadiusM: 100, radiusIncrementM: 400, maximumRadiusM: 500,
      offerTtlSeconds: 30, maximumSearchSeconds: 120, driverCooldownSeconds: 0,
      locationFreshnessSeconds: 120, maximumLocationAccuracyM: 100,
      batchSize: 1, fairnessMode: "DISTANCE_THEN_LONGEST_IDLE",
    };
    assert.equal((await request(adminToken, "/v1/dispatch/policy", "PUT", policy, "phase3-policy-0001")).status, 201);

    const driverBody = (driverRef: string, principalSubject: string, vehicleRef: string, status = "ACTIVE") => ({
      tenantRef, branchRef, driverRef, principalSubject,
      verificationStatus: "VERIFIED", status,
      vehicle: { vehicleRef, type: "MOTORCYCLE", capacityKg: 50 },
    });
    const driverA = driverBody("driver:a", driverAPrincipal, "vehicle:a");
    const driverB = driverBody("driver:b", driverBPrincipal, "vehicle:b");
    assert.equal((await request(adminToken, "/v1/dispatch/drivers", "PUT", driverA, "phase3-driver-a-create")).status, 201);
    assert.equal((await request(adminToken, "/v1/dispatch/drivers", "PUT", driverB, "phase3-driver-b-create")).status, 201);
    const duplicateVehicle = await request(adminToken, "/v1/dispatch/drivers", "PUT", {
      ...driverBody("driver:c", `phase3-driver-c-${randomUUID()}`, "vehicle:b"),
    }, "phase3-driver-duplicate-vehicle");
    assert.equal(duplicateVehicle.status, 409);
    assert.equal((await duplicateVehicle.json() as { error: { code: string } }).error.code, "VEHICLE_ALREADY_ASSIGNED");
    const availability = { tenantRef, branchRef, state: "ONLINE" };
    assert.equal((await request(driverAToken, "/v1/driver/availability", "POST", availability, "phase3-driver-a-online")).status, 200);
    assert.equal((await request(driverBToken, "/v1/driver/availability", "POST", availability, "phase3-driver-b-online")).status, 200);

    const observedAt = new Date().toISOString();
    const validLocation = { tenantRef, branchRef, sequence: 10, longitude: 100.502, latitude: 13.75, accuracyM: 12, deviceObservedAt: observedAt, mockLocation: false };
    assert.equal((await request(driverAToken, "/v1/driver/locations", "POST", validLocation, "phase3-driver-a-location-10")).status, 202);
    assert.equal((await request(driverBToken, "/v1/driver/locations", "POST", validLocation, "phase3-driver-b-location-10")).status, 202);
    const stale = { ...validLocation, sequence: 11, deviceObservedAt: new Date(Date.now() - 180_000).toISOString() };
    const mock = { ...validLocation, sequence: 12, deviceObservedAt: new Date().toISOString(), mockLocation: true };
    const outOfOrder = { ...validLocation, sequence: 9, deviceObservedAt: new Date().toISOString() };
    assert.equal((await request(driverAToken, "/v1/driver/locations", "POST", stale, "phase3-driver-a-location-stale")).status, 422);
    assert.equal((await request(driverAToken, "/v1/driver/locations", "POST", mock, "phase3-driver-a-location-mock")).status, 422);
    assert.equal((await request(driverAToken, "/v1/driver/locations", "POST", outOfOrder, "phase3-driver-a-location-order")).status, 422);
    const duplicateSequence = await request(driverAToken, "/v1/driver/locations", "POST", validLocation, "phase3-driver-a-location-duplicate");
    assert.equal(duplicateSequence.status, 409);
    assert.equal((await duplicateSequence.json() as { error: { code: string } }).error.code, "LOCATION_SEQUENCE_REUSED");
    const crossTenant = await request(driverAToken, "/v1/driver/availability", "POST", {
      tenantRef: "tenant:not-authorized", branchRef, state: "OFFLINE",
    }, "phase3-driver-cross-tenant");
    assert.equal(crossTenant.status, 404);

    await ownerPool.query(
      `UPDATE fleet_delivery.drivers SET last_assigned_at=CASE driver_ref
         WHEN 'driver:a' THEN '2020-01-01T00:00:00Z'::timestamptz
         ELSE '2024-01-01T00:00:00Z'::timestamptz END
       WHERE tenant_ref=$1`,
      [tenantRef],
    );
    const firstDelivery = await createReadyDelivery(ownerPool, tenantRef, branchRef);
    const started = await request(adminToken, `/v1/deliveries/${firstDelivery.id}/actions/start_dispatch`, "POST", {
      tenantRef, branchRef, expectedVersion: firstDelivery.version,
    }, "phase3-start-first");
    assert.equal(started.status, 202);
    const firstAttemptId = (await started.json() as { attemptId: string }).attemptId;
    await claimExpected(firstAttemptId, "worker:phase3-a");
    assert.equal((await advanceDispatchAttempt(workerPool, firstAttemptId, "worker:phase3-a")).result, "RADIUS_EXPANDED");
    await claimExpected(firstAttemptId, "worker:phase3-a");
    const offered = await advanceDispatchAttempt(workerPool, firstAttemptId, "worker:phase3-a");
    assert.equal(offered.result, "OFFERED");
    assert(offered.offerId);
    const selected = await ownerPool.query<{ driver_ref: string; fairness_evidence: Record<string, unknown> }>(
      `SELECT d.driver_ref, o.fairness_evidence
         FROM fleet_delivery.dispatch_offers o JOIN fleet_delivery.drivers d ON d.id=o.driver_id
        WHERE o.id=$1`,
      [offered.offerId],
    );
    assert.equal(selected.rows[0]?.driver_ref, "driver:a");
    assert.equal(selected.rows[0]?.fairness_evidence.fairnessMode, "DISTANCE_THEN_LONGEST_IDLE");
    assert.equal(selected.rows[0]?.fairness_evidence.policyVersion, 1);
    const driverAFeed = await getOffers(driverAToken);
    assert.equal(driverAFeed.status, 200);
    const driverAOffers = await driverAFeed.json() as { offers: Array<{ offerId: string; version: number }> };
    assert.equal(driverAOffers.offers.length, 1);
    assert.equal(driverAOffers.offers[0]?.offerId, offered.offerId);
    assert.equal(driverAOffers.offers[0]?.version, 1);
    const driverBFeed = await getOffers(driverBToken);
    assert.equal(driverBFeed.status, 200);
    assert.deepEqual((await driverBFeed.json() as { offers: unknown[] }).offers, []);
    const offeredSnapshot = await getSnapshot(driverAToken);
    assert.equal(offeredSnapshot.status, 200);
    const offeredSnapshotBody = await offeredSnapshot.json() as {
      availability: { state: string } | null;
      assignment: unknown;
      offers: Array<{ offerId: string }>;
    };
    assert.equal(offeredSnapshotBody.availability?.state, "ONLINE");
    assert.equal(offeredSnapshotBody.assignment, null);
    assert.equal(offeredSnapshotBody.offers[0]?.offerId, offered.offerId);
    const otherDriverSnapshot = await getSnapshot(driverBToken);
    assert.deepEqual((await otherDriverSnapshot.json() as { offers: unknown[] }).offers, []);
    assert.equal((await getOffers(driverAToken, "tenant:not-authorized")).status, 404);
    assert.equal((await getSnapshot(driverAToken, "tenant:not-authorized")).status, 404);
    assert.equal((await (await getCurrentAssignment(driverAToken)).json() as { assignment: unknown }).assignment, null);
    const wrongDriver = await request(driverBToken, `/v1/dispatch/offers/${offered.offerId}/accept`, "POST", {
      tenantRef, branchRef, expectedOfferVersion: 1,
    }, "phase3-wrong-driver-accept");
    assert.equal(wrongDriver.status, 404);

    const accepts = await Promise.all(Array.from({ length: 100 }, (_, index) => request(
      driverAToken,
      `/v1/dispatch/offers/${offered.offerId}/accept`,
      "POST",
      { tenantRef, branchRef, expectedOfferVersion: 1 },
      `phase3-accept-${String(index).padStart(3, "0")}`,
    )));
    assert.equal(accepts.every((response) => response.status === 200), true);
    const acceptBodies = await Promise.all(accepts.map((response) => response.json() as Promise<{ assignmentId: string }>));
    assert.equal(new Set(acceptBodies.map((body) => body.assignmentId)).size, 1);
    assert.deepEqual((await (await getOffers(driverAToken)).json() as { offers: unknown[] }).offers, []);
    const currentAssignmentResponse = await getCurrentAssignment(driverAToken);
    assert.equal(currentAssignmentResponse.status, 200);
    const currentAssignment = await currentAssignmentResponse.json() as {
      assignment: {
        assignmentId: string;
        deliveryId: string;
        offerId: string;
        deliveryState: string;
        deliveryVersion: number;
      } | null;
    };
    assert.equal(currentAssignment.assignment?.assignmentId, acceptBodies[0]?.assignmentId);
    assert.equal(currentAssignment.assignment?.deliveryId, firstDelivery.id);
    assert.equal(currentAssignment.assignment?.offerId, offered.offerId);
    assert.equal(currentAssignment.assignment?.deliveryState, "ASSIGNED");
    assert.equal((await (await getCurrentAssignment(driverBToken)).json() as { assignment: unknown }).assignment, null);
    assert.equal((await getCurrentAssignment(driverAToken, "tenant:not-authorized")).status, 404);
    assert(currentAssignment.assignment);
    const skippedArrival = await request(
      driverAToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/arrive_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: currentAssignment.assignment.deliveryVersion },
      "phase4-arrival-skip",
    );
    assert.equal(skippedArrival.status, 409);
    assert.equal(
      (await skippedArrival.json() as { error: { code: string } }).error.code,
      "INVALID_DRIVER_JOURNEY_TRANSITION",
    );
    const wrongDriverJourney = await request(
      driverBToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/start_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: currentAssignment.assignment.deliveryVersion },
      "phase4-wrong-driver-start",
    );
    assert.equal(wrongDriverJourney.status, 404);
    const pickupStarted = await request(
      driverAToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/start_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: currentAssignment.assignment.deliveryVersion },
      "phase4-start-pickup",
    );
    assert.equal(pickupStarted.status, 200);
    const pickupStartedBody = await pickupStarted.json() as { state: string; version: number };
    assert.equal(pickupStartedBody.state, "EN_ROUTE_PICKUP");
    const pickupReplay = await request(
      driverAToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/start_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: currentAssignment.assignment.deliveryVersion },
      "phase4-start-pickup",
    );
    assert.deepEqual(await pickupReplay.json(), pickupStartedBody);
    await ownerPool.query(
      `INSERT INTO fleet_delivery.driver_locations (
         tenant_ref, branch_ref, driver_id, sequence, location, accuracy_m,
         device_observed_at, received_at, mock_location, accepted, rejection_reason
       )
       SELECT o.tenant_ref, o.branch_ref, o.driver_id, 50,
              ST_SetSRID(ST_MakePoint(100.502,13.75),4326),12,
              now()-interval '3 minutes',now()-interval '3 minutes',false,true,null
         FROM fleet_delivery.dispatch_offers o WHERE o.id=$1`,
      [offered.offerId],
    );
    const staleArrival = await request(
      driverAToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/arrive_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: pickupStartedBody.version },
      "phase4-arrive-pickup-stale",
    );
    assert.equal(staleArrival.status, 409);
    assert.equal(
      (await staleArrival.json() as { error: { code: string } }).error.code,
      "ARRIVAL_LOCATION_REQUIRED",
    );
    const freshArrivalLocation = {
      ...validLocation,
      sequence: 51,
      deviceObservedAt: new Date().toISOString(),
    };
    assert.equal((await request(
      driverAToken,
      "/v1/driver/locations",
      "POST",
      freshArrivalLocation,
      "phase4-arrival-location-51",
    )).status, 202);
    const arrivedPickup = await request(
      driverAToken,
      `/v1/driver/deliveries/${firstDelivery.id}/actions/arrive_pickup`,
      "POST",
      { tenantRef, branchRef, expectedVersion: pickupStartedBody.version },
      "phase4-arrive-pickup",
    );
    assert.equal(arrivedPickup.status, 200);
    const arrivedPickupBody = await arrivedPickup.json() as {
      state: string;
      version: number;
      evidence: { driverLocationSequence: number; accuracyM: number };
    };
    assert.equal(arrivedPickupBody.state, "AT_PICKUP");
    assert.equal(arrivedPickupBody.evidence.driverLocationSequence, 51);
    assert.equal(arrivedPickupBody.evidence.accuracyM, 12);
    const restoredAtPickup = await getCurrentAssignment(driverAToken);
    assert.equal(
      (await restoredAtPickup.json() as { assignment: { deliveryState: string } }).assignment.deliveryState,
      "AT_PICKUP",
    );
    const atPickupSnapshot = await getSnapshot(driverAToken);
    const atPickupSnapshotBody = await atPickupSnapshot.json() as {
      availability: { state: string } | null;
      assignment: { deliveryState: string } | null;
      offers: unknown[];
    };
    assert.equal(atPickupSnapshotBody.availability?.state, "BUSY");
    assert.equal(atPickupSnapshotBody.assignment?.deliveryState, "AT_PICKUP");
    assert.deepEqual(atPickupSnapshotBody.offers, []);
    const transitionEvidence = await ownerPool.query<{
      actor_type: string;
      evidence: { driverLocationSequence: number; syntheticOnly: boolean };
    }>(
      `SELECT actor_type, evidence
         FROM fleet_delivery.delivery_state_transitions
        WHERE delivery_id=$1 AND action='arrive_pickup'`,
      [firstDelivery.id],
    );
    assert.equal(transitionEvidence.rows[0]?.actor_type, "DRIVER");
    assert.equal(transitionEvidence.rows[0]?.evidence.driverLocationSequence, 51);
    assert.equal(transitionEvidence.rows[0]?.evidence.syntheticOnly, true);
    const driverAudits = await ownerPool.query<{ action: string; actor_type: string }>(
      `SELECT action, actor_type FROM fleet_delivery.audit_logs
        WHERE target_ref=$1 AND action IN ('dispatch.offer_accepted','driver.journey.start_pickup','driver.journey.arrive_pickup')
        ORDER BY action`,
      [firstDelivery.id],
    );
    assert.equal(driverAudits.rows.length, 3);
    assert.equal(driverAudits.rows.every((row) => row.actor_type === "DRIVER"), true);
    const assignments = await ownerPool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM fleet_delivery.driver_assignments WHERE delivery_id=$1",
      [firstDelivery.id],
    );
    assert.equal(assignments.rows[0]?.count, 1);

    const secondDelivery = await createReadyDelivery(ownerPool, tenantRef, branchRef);
    const secondStart = await request(adminToken, `/v1/deliveries/${secondDelivery.id}/actions/start_dispatch`, "POST", {
      tenantRef, branchRef, expectedVersion: secondDelivery.version,
    }, "phase3-start-second");
    const secondAttemptId = (await secondStart.json() as { attemptId: string }).attemptId;
    await claimExpected(secondAttemptId, "worker:phase3-b");
    assert.equal((await advanceDispatchAttempt(workerPool, secondAttemptId, "worker:phase3-b")).result, "RADIUS_EXPANDED");
    await claimExpected(secondAttemptId, "worker:phase3-b");
    const secondOffer = await advanceDispatchAttempt(workerPool, secondAttemptId, "worker:phase3-b");
    assert.equal(secondOffer.result, "OFFERED");
    assert(secondOffer.offerId);
    assert.equal((await request(
      adminToken, "/v1/dispatch/drivers", "PUT", { ...driverB, status: "SUSPENDED" }, "phase3-driver-b-suspend",
    )).status, 201);
    const suspendedAccept = await request(driverBToken, `/v1/dispatch/offers/${secondOffer.offerId}/accept`, "POST", {
      tenantRef, branchRef, expectedOfferVersion: 1,
    }, "phase3-suspended-accept");
    assert.equal(suspendedAccept.status, 409);
    assert.equal((await suspendedAccept.json() as { error: { code: string } }).error.code, "DRIVER_NO_LONGER_ELIGIBLE");
    await ownerPool.query(
      `UPDATE fleet_delivery.dispatch_offers
          SET offered_at=now()-interval '10 seconds', expires_at=now()-interval '1 second'
        WHERE id=$1`,
      [secondOffer.offerId],
    );
    const lateAccept = await request(driverBToken, `/v1/dispatch/offers/${secondOffer.offerId}/accept`, "POST", {
      tenantRef, branchRef, expectedOfferVersion: 1,
    }, "phase3-late-accept");
    assert.equal(lateAccept.status, 409);
    assert.equal((await lateAccept.json() as { error: { code: string } }).error.code, "OFFER_ALREADY_DECIDED");

    const thirdDelivery = await createReadyDelivery(ownerPool, tenantRef, branchRef);
    const thirdStart = await request(adminToken, `/v1/deliveries/${thirdDelivery.id}/actions/start_dispatch`, "POST", {
      tenantRef, branchRef, expectedVersion: thirdDelivery.version,
    }, "phase3-start-third");
    const thirdAttemptId = (await thirdStart.json() as { attemptId: string }).attemptId;
    await claimExpected(thirdAttemptId, "worker:lease-old", 1);
    await ownerPool.query(
      "UPDATE fleet_delivery.dispatch_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [thirdAttemptId],
    );
    await claimExpected(thirdAttemptId, "worker:lease-new");
    assert.equal((await advanceDispatchAttempt(workerPool, thirdAttemptId, "worker:lease-new")).result, "RADIUS_EXPANDED");
    await claimExpected(thirdAttemptId, "worker:lease-new");
    assert.equal((await advanceDispatchAttempt(workerPool, thirdAttemptId, "worker:lease-new")).result, "MANUAL_ESCALATION");
    const manual = await ownerPool.query<{ state: string; reason: string }>(
      `SELECT d.state, q.reason FROM fleet_delivery.deliveries d
       JOIN fleet_delivery.dispatch_manual_queue q ON q.delivery_id=d.id WHERE d.id=$1`,
      [thirdDelivery.id],
    );
    assert.deepEqual(manual.rows[0], { state: "MANUAL_DISPATCH_REQUIRED", reason: "NO_ELIGIBLE_DRIVER" });

    const appClient = await appPool.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', 'tenant:other', true)");
      const invisible = await appClient.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM fleet_delivery.drivers WHERE tenant_ref=$1",
        [tenantRef],
      );
      assert.equal(invisible.rows[0]?.count, 0);
      await appClient.query("ROLLBACK");
    } finally {
      appClient.release();
    }
    const rejectedLocations = await ownerPool.query<{ rejection_reason: string }>(
      "SELECT rejection_reason FROM fleet_delivery.driver_locations WHERE tenant_ref=$1 AND accepted=false ORDER BY sequence",
      [tenantRef],
    );
    assert.deepEqual(new Set(rejectedLocations.rows.map((row) => row.rejection_reason)), new Set(["OUT_OF_ORDER", "STALE", "MOCK_SIGNAL"]));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const tables = [
      "dispatch_manual_queue", "driver_assignments", "dispatch_offers", "dispatch_attempts",
      "driver_locations", "driver_availability", "driver_vehicles", "driver_memberships", "drivers",
      "dispatch_policy_versions", "delivery_state_transitions", "deliveries", "delivery_quotes",
      "order_context_snapshots", "outbox_events", "idempotency_keys", "audit_logs",
    ];
    await ownerPool.query("SET session_replication_role = replica");
    try {
      for (const table of tables) {
        await ownerPool.query(`DELETE FROM fleet_delivery.${table} WHERE tenant_ref=$1`, [tenantRef]).catch(() => undefined);
      }
    } finally {
      await ownerPool.query("SET session_replication_role = origin");
    }
    await ownerPool.query("DELETE FROM fleet_delivery.integration_mappings WHERE principal_subject=$1", [adminPrincipal]);
    await Promise.allSettled([workerPool.end(), appPool.end(), ownerPool.end(), redis.quit()]);
  }
});
