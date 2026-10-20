import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  financeCapabilitiesV1Schema,
  operationsDeliveryFeedV1Schema,
  operationsOverviewV1Schema,
} from "@bms/fleet-delivery-contracts";
import { createDatabasePool, isServiceTokenRevoked } from "@bms/fleet-delivery-database";
import { createRedisClient } from "@bms/fleet-delivery-shared";
import { createFleetDeliveryServer } from "./server.js";
import { createServiceTokenVerifier } from "./serviceAuth.js";

const databaseUrl = process.env.FLEET_DELIVERY_TEST_DATABASE_URL?.trim();
const redisUrl = process.env.FLEET_DELIVERY_TEST_REDIS_URL?.trim();

test("authenticated event ingestion derives mapping and preserves inbox identity", {
  skip: !databaseUrl || !redisUrl,
}, async () => {
  const ownerPool = createDatabasePool(databaseUrl!, 2);
  const appUrl = new URL(databaseUrl!);
  appUrl.searchParams.set("options", "-c role=fleet_delivery_app");
  const appPool = createDatabasePool(appUrl.toString(), 2);
  const redis = createRedisClient(redisUrl!);
  const principal = `bms-adapter-${randomUUID()}`;
  const tenantRef = `tenant:test-${randomUUID()}`;
  const branchRef = "branch:main";
  const messageId = randomUUID();
  await redis.connect();
  await ownerPool.query(
    `INSERT INTO fleet_delivery.integration_mappings (
      principal_subject, external_tenant_ref, external_branch_ref, allowed_producer
    ) VALUES ($1, $2, $3, 'synthetic-test')`,
    [principal, tenantRef, branchRef],
  );

  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "integration-test-key";
  publicJwk.alg = "EdDSA";
  const token = await new SignJWT({ scopes: [
    "events.ingest",
    "merchant.settings.write",
    "quotes.create",
    "deliveries.create",
    "deliveries.transition",
    "reconciliation.read",
    "finance.capabilities.read",
    "operations.read",
  ] })
    .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
    .setIssuer("synthetic-bms")
    .setAudience("fleet-delivery")
    .setSubject(principal)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const tokenWithoutFinanceScope = await new SignJWT({ scopes: ["reconciliation.read"] })
    .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
    .setIssuer("synthetic-bms")
    .setAudience("fleet-delivery")
    .setSubject(principal)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const verifyServiceToken = createServiceTokenVerifier({
    jwks: { keys: [publicJwk] },
    issuer: "synthetic-bms",
    audience: "fleet-delivery",
    isRevoked: (claims) => isServiceTokenRevoked(appPool, claims),
  });
  const server = createFleetDeliveryServer({
    pool: appPool,
    redis,
    verifyServiceToken,
    maxBodyBytes: 65_536,
    serviceRateLimitPerMinute: 100,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/v1/integration/events`;
    const envelope = {
      messageId,
      messageType: "bms.order-context-changed.v1",
      schemaVersion: 1,
      producer: "synthetic-test",
      tenantRef,
      branchRef,
      aggregateType: "bms-order",
      aggregateRef: "order:synthetic-1",
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      causationId: null,
      payload: {
        fulfillmentType: "DELIVERY",
        paymentState: "UNPAID",
        merchantReadiness: "NOT_ACCEPTED",
        eligibility: {
          version: "eligibility:v1",
          decision: "ELIGIBLE",
          blockers: [],
          evaluatedAt: new Date().toISOString(),
        },
        dropoff: { longitude: 100.5018, latitude: 13.7563, confidence: 0.99 },
        route: {
          provider: "synthetic",
          reference: "route:synthetic-1",
          distanceMeters: 1_001,
          observedAt: new Date().toISOString(),
        },
      },
    };
    const request = (body: unknown) => fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const getIssues = (tenant = tenantRef, cursor?: string) => {
      const query = new URLSearchParams({ tenantRef: tenant, branchRef, limit: "1" });
      if (cursor) query.set("cursor", cursor);
      return fetch(`${url.replace("/events", "/reconciliation/issues")}?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    };
    const first = await request(envelope);
    assert.equal(first.status, 202);
    assert.equal((await first.json() as { status: string }).status, "STORED");
    const duplicate = await request(envelope);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { status: string }).status, "DUPLICATE");
    const mismatch = await request({ ...envelope, payload: { status: "PACKING" } });
    assert.equal(mismatch.status, 409);
    const versionThreePayload = {
      ...envelope.payload,
      paymentState: "CONFIRMED",
      merchantReadiness: "READY",
      eligibility: { ...envelope.payload.eligibility, version: "eligibility:v3" },
      route: { ...envelope.payload.route, reference: "route:synthetic-3" },
    };
    const gap = await request({
      ...envelope,
      messageId: randomUUID(),
      aggregateVersion: 3,
      payload: versionThreePayload,
    });
    assert.equal(gap.status, 202);
    assert.equal((await gap.json() as { handler: string }).handler, "VERSION_GAP");
    const beforeSnapshot = await ownerPool.query<{ order_version: string }>(
      `SELECT order_version FROM fleet_delivery.order_context_snapshots
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND current`,
      [tenantRef, branchRef, envelope.aggregateRef],
    );
    assert.equal(beforeSnapshot.rows[0]?.order_version, "1");
    const snapshot = await request({
      ...envelope,
      messageId: randomUUID(),
      messageType: "bms.order-context-snapshot.v1",
      aggregateVersion: 3,
      payload: versionThreePayload,
    });
    assert.equal(snapshot.status, 202);
    assert.equal((await snapshot.json() as { handler: string }).handler, "APPLIED");
    const afterSnapshot = await ownerPool.query<{ order_version: string; payment_state: string }>(
      `SELECT order_version, payment_state FROM fleet_delivery.order_context_snapshots
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND current`,
      [tenantRef, branchRef, envelope.aggregateRef],
    );
    assert.deepEqual(afterSnapshot.rows[0], { order_version: "3", payment_state: "CONFIRMED" });
    const stale = await request({
      ...envelope,
      messageId: randomUUID(),
      aggregateVersion: 2,
      payload: { ...envelope.payload, eligibility: { ...envelope.payload.eligibility, version: "eligibility:v2" } },
    });
    assert.equal(stale.status, 202);
    assert.equal((await stale.json() as { handler: string }).handler, "STALE");
    const gapInbox = await ownerPool.query<{ status: string; result: Record<string, unknown> }>(
      `SELECT status, result FROM fleet_delivery.inbox_events
        WHERE tenant_ref=$1 AND result->>'reason'='ORDER_CONTEXT_VERSION_GAP'`,
      [tenantRef],
    );
    assert.equal(gapInbox.rows[0]?.status, "ACTION_REQUIRED");
    assert.equal(gapInbox.rows[0]?.result.requiredMessageType, "bms.order-context-snapshot.v1");
    const issuesPageOne = await getIssues();
    assert.equal(issuesPageOne.status, 200);
    const pageOne = await issuesPageOne.json() as {
      issues: Array<{ reason: string; aggregateRef: string }>;
      nextCursor: string | null;
    };
    assert.equal(pageOne.issues.length, 1);
    assert.equal(pageOne.issues[0]?.reason, "ORDER_CONTEXT_VERSION_GAP");
    assert.equal(pageOne.issues[0]?.aggregateRef, envelope.aggregateRef);
    assert(pageOne.nextCursor);
    const issuesPageTwo = await getIssues(tenantRef, pageOne.nextCursor);
    const pageTwo = await issuesPageTwo.json() as {
      issues: Array<{ reason: string }>;
      nextCursor: string | null;
    };
    assert.equal(pageTwo.issues[0]?.reason, "STALE_ORDER_CONTEXT");
    assert.equal(pageTwo.nextCursor, null);
    assert.equal((await getIssues(tenantRef, "bad")).status, 422);
    assert.equal((await getIssues("tenant:not-mapped")).status, 404);
    const wrongProducer = await request({ ...envelope, messageId: randomUUID(), producer: "fleet-delivery" });
    assert.equal(wrongProducer.status, 404);
    const unmapped = await request({ ...envelope, messageId: randomUUID(), tenantRef: "tenant:not-mapped" });
    assert.equal(unmapped.status, 404);

    const financeQuery = new URLSearchParams({ tenantRef, branchRef });
    assert.equal((await fetch(
      `${url.replace("/integration/events", "/finance/capabilities")}?${financeQuery}`,
      { headers: { authorization: `Bearer ${tokenWithoutFinanceScope}` } },
    )).status, 403);
    const capabilities = await fetch(
      `${url.replace("/integration/events", "/finance/capabilities")}?${financeQuery}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(capabilities.status, 200);
    const capabilityBody = financeCapabilitiesV1Schema.parse(await capabilities.json());
    assert.equal(capabilityBody.mode, "SHADOW_ONLY");
    assert.equal(capabilityBody.realMoneyEnabled, false);
    assert.equal(Object.values(capabilityBody.capabilities).every((enabled) => !enabled), true);
    financeQuery.set("tenantRef", "tenant:not-mapped");
    assert.equal((await fetch(
      `${url.replace("/integration/events", "/finance/capabilities")}?${financeQuery}`,
      { headers: { authorization: `Bearer ${token}` } },
    )).status, 404);

    const operationsQuery = new URLSearchParams({ tenantRef, branchRef });
    assert.equal((await fetch(
      `${url.replace("/integration/events", "/operations/overview")}?${operationsQuery}`,
      { headers: { authorization: `Bearer ${tokenWithoutFinanceScope}` } },
    )).status, 403);
    const overview = await fetch(
      `${url.replace("/integration/events", "/operations/overview")}?${operationsQuery}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(overview.status, 200);
    const overviewBody = operationsOverviewV1Schema.parse(await overview.json());
    assert.equal(overviewBody.deliveryCounts.length, 0);
    assert.equal(overviewBody.openManualDispatchCount, 0);
    assert.equal(overviewBody.actionRequiredIntegrationCount, 2);

    const deliveries = await fetch(
      `${url.replace("/integration/events", "/operations/deliveries")}?${operationsQuery}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(deliveries.status, 200);
    assert.equal(operationsDeliveryFeedV1Schema.parse(await deliveries.json()).deliveries.length, 0);
    assert.equal((await fetch(
      `${url.replace("/integration/events", "/operations/deliveries")}?${operationsQuery}&cursor=bad`,
      { headers: { authorization: `Bearer ${token}` } },
    )).status, 422);
    operationsQuery.set("tenantRef", "tenant:not-mapped");
    assert.equal((await fetch(
      `${url.replace("/integration/events", "/operations/overview")}?${operationsQuery}`,
      { headers: { authorization: `Bearer ${token}` } },
    )).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ownerPool.query("DELETE FROM fleet_delivery.order_context_snapshots WHERE tenant_ref = $1", [tenantRef]);
    await ownerPool.query("DELETE FROM fleet_delivery.inbox_events WHERE tenant_ref = $1", [tenantRef]);
    await ownerPool.query("DELETE FROM fleet_delivery.integration_mappings WHERE principal_subject = $1", [principal]);
    await Promise.allSettled([appPool.end(), ownerPool.end(), redis.quit()]);
  }
});
