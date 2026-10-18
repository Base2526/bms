import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { operationsDeliveryFeedV1Schema, operationsOverviewV1Schema } from "@bms/fleet-delivery-contracts";
import { createDatabasePool, createDelivery, isServiceTokenRevoked } from "@bms/fleet-delivery-database";
import { createRedisClient } from "@bms/fleet-delivery-shared";
import { createFleetDeliveryServer } from "./server.js";
import { createServiceTokenVerifier } from "./serviceAuth.js";

const databaseUrl = process.env.FLEET_DELIVERY_TEST_DATABASE_URL?.trim();
const redisUrl = process.env.FLEET_DELIVERY_TEST_REDIS_URL?.trim();

test("phase 2 API quotes, creates and transitions one synthetic delivery with a balanced journal", {
  skip: !databaseUrl || !redisUrl,
}, async () => {
  const ownerPool = createDatabasePool(databaseUrl!, 3);
  const appUrl = new URL(databaseUrl!);
  appUrl.searchParams.set("options", "-c role=fleet_delivery_app");
  const appPool = createDatabasePool(appUrl.toString(), 3);
  const redis = createRedisClient(redisUrl!);
  const principal = `phase2-adapter-${randomUUID()}`;
  const tenantRef = `tenant:phase2-${randomUUID()}`;
  const branchRef = "branch:main";
  const bmsOrderRef = `order:${randomUUID()}`;
  await redis.connect();
  await ownerPool.query(
    `INSERT INTO fleet_delivery.integration_mappings (
      principal_subject, external_tenant_ref, external_branch_ref, allowed_producer
    ) VALUES ($1,$2,$3,'synthetic-test')`,
    [principal, tenantRef, branchRef],
  );
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "phase2-test-key";
  publicJwk.alg = "EdDSA";
  const token = await new SignJWT({ scopes: [
    "events.ingest", "merchant.settings.write", "quotes.create",
    "deliveries.create", "deliveries.transition", "operations.read", "customer.grants.write",
  ] })
    .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
    .setIssuer("synthetic-bms")
    .setAudience("fleet-delivery")
    .setSubject(principal)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const server = createFleetDeliveryServer({
    pool: appPool,
    redis,
    verifyServiceToken: createServiceTokenVerifier({
      jwks: { keys: [publicJwk] },
      issuer: "synthetic-bms",
      audience: "fleet-delivery",
      isRevoked: (claims) => isServiceTokenRevoked(appPool, claims),
    }),
    maxBodyBytes: 65_536,
    serviceRateLimitPerMinute: 1_000,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method: string, body: unknown, idempotencyKey?: string) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const customerRequest = (
      customerToken: string,
      path: string,
      body: unknown,
      idempotencyKey: string,
    ) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const customerStatus = (customerToken: string) => fetch(`${baseUrl}/v1/customer/deliveries/current`, {
      headers: { authorization: `Bearer ${customerToken}` },
    });
    const weeklyHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek, opensAt: "00:00", closesAt: "23:59",
    }));
    const serviceRequirement = {
      serviceType: "ON_DEMAND" as const,
      requiredVehicleType: "MOTORCYCLE" as const,
      requiredCapacityKg: 20,
      packageWeightKg: 12.5,
      packageSizeClass: "SMALL" as const,
      specialHandling: [],
      requirementVersion: "phase2-motorcycle:v1",
    };
    const configurationBody = {
      tenantRef,
      branchRef,
      version: 1,
      enabled: true,
      timezone: "Asia/Bangkok",
      readinessPolicy: "EXPLICIT",
      weeklyHours,
      quoteTtlSeconds: 60,
      serviceArea: {
        name: "Synthetic Bangkok square",
        geoJson: {
          type: "Polygon",
          coordinates: [[[100.0, 13.0], [101.0, 13.0], [101.0, 14.0], [100.0, 14.0], [100.0, 13.0]]],
        },
      },
      pricing: {
        ruleVersion: "phase2:v1",
        baseFareSatang: 1_500,
        perStartedKmSatang: 700,
        minimumFareSatang: 2_000,
        fixedMerchantSubsidySatang: 500,
        commissionBps: 500,
      },
    };
    const configured = await request("/v1/merchant/configuration", "PUT", configurationBody, "config-phase2-0001");
    assert.equal(configured.status, 201);
    const configurationResult = await configured.json() as { configurationId: string };
    const configurationReplay = await request("/v1/merchant/configuration", "PUT", configurationBody, "config-phase2-0001");
    assert.equal(configurationReplay.status, 201);
    assert.equal((await configurationReplay.json() as { configurationId: string }).configurationId, configurationResult.configurationId);
    const changedConfiguration = await request(
      "/v1/merchant/configuration",
      "PUT",
      { ...configurationBody, enabled: false },
      "config-phase2-0001",
    );
    assert.equal(changedConfiguration.status, 409);

    const now = new Date();
    const envelope = {
      messageId: randomUUID(),
      messageType: "bms.order-context-changed.v1",
      schemaVersion: 1,
      producer: "synthetic-test",
      tenantRef,
      branchRef,
      aggregateType: "bms-order",
      aggregateRef: bmsOrderRef,
      aggregateVersion: 1,
      occurredAt: now.toISOString(),
      correlationId: randomUUID(),
      causationId: null,
      payload: {
        fulfillmentType: "DELIVERY",
        paymentState: "UNPAID",
        merchantReadiness: "NOT_ACCEPTED",
        eligibility: { version: "eligible:v1", decision: "ELIGIBLE", blockers: [], evaluatedAt: now.toISOString() },
        dropoff: { longitude: 100.5018, latitude: 13.7563, confidence: 0.99 },
        route: { provider: "synthetic", reference: "route:phase2", distanceMeters: 1_001, observedAt: now.toISOString() },
      },
    };
    const ingested = await request("/v1/integration/events", "POST", envelope);
    assert.equal(ingested.status, 202);
    assert.equal((await ingested.json() as { handler: string }).handler, "APPLIED");

    const ineligibleOrderRef = `order:${randomUUID()}`;
    const ineligibleEnvelope = {
      ...envelope,
      messageId: randomUUID(),
      aggregateRef: ineligibleOrderRef,
      correlationId: randomUUID(),
      payload: {
        ...envelope.payload,
        eligibility: {
          ...envelope.payload.eligibility,
          version: "ineligible:v1",
          decision: "INELIGIBLE",
          blockers: ["REGULATED_ITEM"],
        },
      },
    };
    assert.equal((await request("/v1/integration/events", "POST", ineligibleEnvelope)).status, 202);
    const ineligibleQuote = await request("/v1/quotes", "POST", {
      tenantRef, branchRef, bmsOrderRef: ineligibleOrderRef, expectedOrderVersion: 1, serviceRequirement,
    }, "quote-phase2-ineligible");
    assert.equal(ineligibleQuote.status, 422);

    const staleOrderRef = `order:${randomUUID()}`;
    const staleTime = new Date(now.getTime() - 16 * 60_000).toISOString();
    const staleEnvelope = {
      ...envelope,
      messageId: randomUUID(),
      aggregateRef: staleOrderRef,
      correlationId: randomUUID(),
      payload: {
        ...envelope.payload,
        eligibility: { ...envelope.payload.eligibility, version: "stale:v1", evaluatedAt: staleTime },
        route: { ...envelope.payload.route, reference: "route:stale", observedAt: staleTime },
      },
    };
    assert.equal((await request("/v1/integration/events", "POST", staleEnvelope)).status, 202);
    const staleQuote = await request("/v1/quotes", "POST", {
      tenantRef, branchRef, bmsOrderRef: staleOrderRef, expectedOrderVersion: 1, serviceRequirement,
    }, "quote-phase2-stale");
    assert.equal(staleQuote.status, 409);

    const outsideOrderRef = `order:${randomUUID()}`;
    const outsideEnvelope = {
      ...envelope,
      messageId: randomUUID(),
      aggregateRef: outsideOrderRef,
      correlationId: randomUUID(),
      payload: {
        ...envelope.payload,
        eligibility: { ...envelope.payload.eligibility, version: "outside:v1" },
        dropoff: { longitude: 99.0, latitude: 12.0, confidence: 0.99 },
        route: { ...envelope.payload.route, reference: "route:outside" },
      },
    };
    assert.equal((await request("/v1/integration/events", "POST", outsideEnvelope)).status, 202);
    const outsideQuote = await request("/v1/quotes", "POST", {
      tenantRef, branchRef, bmsOrderRef: outsideOrderRef, expectedOrderVersion: 1, serviceRequirement,
    }, "quote-phase2-outside");
    assert.equal(outsideQuote.status, 422);

    const customerOrderRef = `order:${randomUUID()}`;
    assert.equal((await request("/v1/integration/events", "POST", {
      ...envelope,
      messageId: randomUUID(),
      aggregateRef: customerOrderRef,
      correlationId: randomUUID(),
      payload: {
        ...envelope.payload,
        eligibility: { ...envelope.payload.eligibility, version: "eligible:customer-v1" },
        route: { ...envelope.payload.route, reference: "route:customer-v1" },
      },
    })).status, 202);
    const firstCustomerToken = randomBytes(32).toString("base64url");
    const secondCustomerToken = randomBytes(32).toString("base64url");
    const grantBody = {
      grantId: randomUUID(), tenantRef, branchRef, bmsOrderRef: customerOrderRef,
      tokenSha256: createHash("sha256").update(firstCustomerToken).digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      allowedActions: ["QUOTE", "CREATE_DELIVERY", "TRACK"], syntheticOnly: true,
    };
    const grant = await request("/v1/customer/grants", "POST", grantBody, "customer-grant-phase2-1");
    assert.equal(grant.status, 201);
    const overlongGrant = await request("/v1/customer/grants", "POST", {
      ...grantBody,
      grantId: randomUUID(),
      tokenSha256: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex"),
      expiresAt: new Date(Date.now() + 61 * 60_000).toISOString(),
    }, "customer-grant-phase2-overlong");
    assert.equal(overlongGrant.status, 422);
    const rotatedGrantBody = {
      ...grantBody,
      grantId: randomUUID(),
      tokenSha256: createHash("sha256").update(secondCustomerToken).digest("hex"),
    };
    assert.equal((await request(
      "/v1/customer/grants", "POST", rotatedGrantBody, "customer-grant-phase2-2",
    )).status, 201);
    assert.equal((await customerRequest(
      firstCustomerToken,
      "/v1/customer/quotes",
      { serviceRequirement },
      "customer-quote-revoked",
    )).status, 401);
    assert.equal((await customerStatus(firstCustomerToken)).status, 401);
    assert.equal((await customerRequest(
      secondCustomerToken,
      "/v1/customer/quotes",
      { serviceRequirement, tenantRef },
      "customer-quote-spoof",
    )).status, 400);
    assert.equal((await customerRequest(
      randomBytes(32).toString("base64url"),
      "/v1/customer/quotes",
      { serviceRequirement },
      "customer-quote-invalid-token",
    )).status, 401);
    const customerQuoted = await customerRequest(
      secondCustomerToken,
      "/v1/customer/quotes",
      { serviceRequirement },
      "customer-quote-phase2",
    );
    assert.equal(customerQuoted.status, 201);
    const customerQuote = await customerQuoted.json() as { quoteId: string };
    const customerCreated = await customerRequest(
      secondCustomerToken,
      "/v1/customer/deliveries",
      { quoteId: customerQuote.quoteId },
      "customer-delivery-phase2",
    );
    assert.equal(customerCreated.status, 201);
    const customerDeliveryId = (await ownerPool.query<{ id: string }>(
      "SELECT id FROM fleet_delivery.deliveries WHERE quote_id=$1",
      [customerQuote.quoteId],
    )).rows[0]!.id;
    assert.deepEqual(await customerCreated.json(), {
      deliveryId: customerDeliveryId,
      state: "AWAITING_PAYMENT",
      version: 1,
      quoteId: customerQuote.quoteId,
      serviceRequirement,
    });
    const customerTracked = await customerStatus(secondCustomerToken);
    assert.equal(customerTracked.status, 200);
    const customerTrackedBody = await customerTracked.json() as {
      serverNow: string;
      delivery: Record<string, unknown> | null;
    };
    assert.doesNotThrow(() => new Date(customerTrackedBody.serverNow).toISOString());
    assert.doesNotThrow(() => new Date(String(customerTrackedBody.delivery?.updatedAt)).toISOString());
    assert.deepEqual(customerTrackedBody.delivery, {
      deliveryId: customerDeliveryId,
      quoteId: customerQuote.quoteId,
      state: "AWAITING_PAYMENT",
      version: 1,
      matchStage: "PAYMENT_REQUIRED",
      currency: "THB",
      grossDeliveryFeeSatang: 2_900,
      customerContributionSatang: 2_400,
      merchantSubsidySatang: 500,
      updatedAt: customerTrackedBody.delivery?.updatedAt,
    });
    assert.equal(JSON.stringify(customerTrackedBody).includes(customerOrderRef), false);
    assert.equal(JSON.stringify(customerTrackedBody).includes("driver"), false);
    const storedGrant = await ownerPool.query<{ token_sha256: string; safe_metadata: unknown }>(
      `SELECT g.token_sha256, a.safe_metadata
         FROM fleet_delivery.customer_grants g
         JOIN fleet_delivery.audit_logs a
           ON a.tenant_ref=g.tenant_ref AND a.target_ref=g.id::text
        WHERE g.id=$1 AND a.action='customer.grant.synthetic_registered'`,
      [rotatedGrantBody.grantId],
    );
    assert.equal(storedGrant.rows[0]?.token_sha256, rotatedGrantBody.tokenSha256);
    assert.equal(JSON.stringify(storedGrant.rows[0]).includes(secondCustomerToken), false);

    const quoteInput = { tenantRef, branchRef, bmsOrderRef, expectedOrderVersion: 1, serviceRequirement };
    const quoted = await request("/v1/quotes", "POST", quoteInput, "quote-phase2-0001");
    assert.equal(quoted.status, 201);
    const quote = await quoted.json() as {
      quoteId: string; grossDeliveryFeeSatang: number; customerContributionSatang: number;
      merchantSubsidySatang: number; commissionSatang: number; expiresAt: string;
      serviceRequirement: typeof serviceRequirement;
    };
    assert.deepEqual({
      gross: quote.grossDeliveryFeeSatang,
      customer: quote.customerContributionSatang,
      subsidy: quote.merchantSubsidySatang,
      commission: quote.commissionSatang,
    }, { gross: 2_900, customer: 2_400, subsidy: 500, commission: 145 });
    assert.deepEqual(quote.serviceRequirement, serviceRequirement);
    const quoteReplay = await request("/v1/quotes", "POST", quoteInput, "quote-phase2-0001");
    assert.equal(quoteReplay.status, 201);
    assert.equal((await quoteReplay.json() as { quoteId: string }).quoteId, quote.quoteId);
    const quoteMismatch = await request(
      "/v1/quotes", "POST", { ...quoteInput, expectedOrderVersion: 2 }, "quote-phase2-0001",
    );
    assert.equal(quoteMismatch.status, 409);
    const crossTenant = await request(
      "/v1/quotes", "POST", { ...quoteInput, tenantRef: "tenant:not-mapped" }, "quote-phase2-cross",
    );
    assert.equal(crossTenant.status, 404);

    await assert.rejects(
      () => createDelivery(appPool, { ...quoteInput, quoteId: quote.quoteId }, {
        principal,
        idempotencyKey: "delivery-expired-check",
        requestId: randomUUID(),
        now: new Date(new Date(quote.expiresAt).getTime() + 1),
      }),
      /QUOTE_EXPIRED/,
    );

    const deliveryInput = { tenantRef, branchRef, bmsOrderRef, quoteId: quote.quoteId };
    const concurrentCreates = await Promise.all([
      request("/v1/deliveries", "POST", deliveryInput, "delivery-phase2-race-a"),
      request("/v1/deliveries", "POST", deliveryInput, "delivery-phase2-race-b"),
    ]);
    assert.deepEqual(concurrentCreates.map((response) => response.status).sort(), [201, 409]);
    const winningIndex = concurrentCreates.findIndex((response) => response.status === 201);
    const created = concurrentCreates[winningIndex]!;
    const winningKey = winningIndex === 0 ? "delivery-phase2-race-a" : "delivery-phase2-race-b";
    const delivery = await created.json() as { deliveryId: string; state: string; version: number };
    assert.equal(delivery.state, "AWAITING_PAYMENT");
    const replay = await request("/v1/deliveries", "POST", deliveryInput, winningKey);
    assert.equal(replay.status, 201);
    assert.equal((await replay.json() as { deliveryId: string }).deliveryId, delivery.deliveryId);
    const frozenRequirement = await ownerPool.query<{
      quote_capacity: number; delivery_capacity: number;
      quote_version: string; delivery_version: string;
    }>(
      `SELECT q.required_capacity_kg AS quote_capacity,
              d.required_capacity_kg AS delivery_capacity,
              q.service_requirement_version AS quote_version,
              d.service_requirement_version AS delivery_version
         FROM fleet_delivery.delivery_quotes q
         JOIN fleet_delivery.deliveries d ON d.quote_id=q.id
        WHERE d.id=$1`,
      [delivery.deliveryId],
    );
    assert.deepEqual(frozenRequirement.rows[0], {
      quote_capacity: 20,
      delivery_capacity: 20,
      quote_version: "phase2-motorcycle:v1",
      delivery_version: "phase2-motorcycle:v1",
    });
    await assert.rejects(() => ownerPool.query(
      "UPDATE fleet_delivery.deliveries SET required_capacity_kg=21 WHERE id=$1",
      [delivery.deliveryId],
    ), /immutable/);

    const secondOrderRef = `order:${randomUUID()}`;
    assert.equal((await request("/v1/integration/events", "POST", {
      ...envelope,
      messageId: randomUUID(),
      aggregateRef: secondOrderRef,
      correlationId: randomUUID(),
      payload: {
        ...envelope.payload,
        eligibility: { ...envelope.payload.eligibility, version: "eligible:operations-page-2" },
        route: { ...envelope.payload.route, reference: "route:operations-page-2" },
      },
    })).status, 202);
    const secondQuoted = await request("/v1/quotes", "POST", {
      tenantRef, branchRef, bmsOrderRef: secondOrderRef, expectedOrderVersion: 1, serviceRequirement,
    }, "quote-phase7-pagination");
    assert.equal(secondQuoted.status, 201);
    const secondQuote = await secondQuoted.json() as { quoteId: string };
    const secondCreated = await request("/v1/deliveries", "POST", {
      tenantRef, branchRef, bmsOrderRef: secondOrderRef, quoteId: secondQuote.quoteId,
    }, "delivery-phase7-pagination");
    assert.equal(secondCreated.status, 201);
    const secondDelivery = await secondCreated.json() as { deliveryId: string };

    const operationsQuery = new URLSearchParams({ tenantRef, branchRef, limit: "2" });
    const operationsPageOneResponse = await fetch(`${baseUrl}/v1/operations/deliveries?${operationsQuery}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(operationsPageOneResponse.status, 200);
    const operationsPageOne = operationsDeliveryFeedV1Schema.parse(await operationsPageOneResponse.json());
    assert.equal(operationsPageOne.deliveries.length, 2);
    assert(operationsPageOne.nextCursor);
    operationsQuery.set("cursor", operationsPageOne.nextCursor);
    const operationsPageTwoResponse = await fetch(`${baseUrl}/v1/operations/deliveries?${operationsQuery}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(operationsPageTwoResponse.status, 200);
    const operationsPageTwo = operationsDeliveryFeedV1Schema.parse(await operationsPageTwoResponse.json());
    assert.equal(operationsPageTwo.deliveries.length, 1);
    assert.equal(operationsPageTwo.nextCursor, null);
    assert.deepEqual(
      new Set([...operationsPageOne.deliveries, ...operationsPageTwo.deliveries].map((entry) => entry.deliveryId)),
      new Set([delivery.deliveryId, secondDelivery.deliveryId, customerDeliveryId]),
    );

    const operationsOverviewResponse = await fetch(
      `${baseUrl}/v1/operations/overview?${new URLSearchParams({ tenantRef, branchRef })}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(operationsOverviewResponse.status, 200);
    const operationsOverview = operationsOverviewV1Schema.parse(await operationsOverviewResponse.json());
    assert.equal(
      operationsOverview.deliveryCounts.find((entry) => entry.state === "AWAITING_PAYMENT")?.count,
      3,
    );

    const transitioned = await request(
      `/v1/deliveries/${delivery.deliveryId}/actions/payment_confirmed`,
      "POST",
      { tenantRef, branchRef, expectedVersion: 1, reasonCode: "SYNTHETIC_PAYMENT_CONFIRMED" },
      "transition-phase2-0001",
    );
    assert.equal(transitioned.status, 200);
    assert.deepEqual(await transitioned.json(), {
      deliveryId: delivery.deliveryId, state: "AWAITING_MERCHANT_ACCEPTANCE", version: 2,
    });
    const skipped = await request(
      `/v1/deliveries/${delivery.deliveryId}/actions/merchant_ready`,
      "POST",
      { tenantRef, branchRef, expectedVersion: 2, reasonCode: "INVALID_SKIP" },
      "transition-phase2-skip",
    );
    assert.equal(skipped.status, 409);

    const balance = await ownerPool.query<{
      debit: string; credit: string; declared_debit_satang: string; declared_credit_satang: string;
    }>(
      `SELECT j.declared_debit_satang, j.declared_credit_satang,
              sum(e.amount_satang) FILTER (WHERE e.side='DEBIT') AS debit,
              sum(e.amount_satang) FILTER (WHERE e.side='CREDIT') AS credit
         FROM fleet_delivery.ledger_journals j
         JOIN fleet_delivery.ledger_entries e ON e.journal_id=j.id
        WHERE j.delivery_id=$1 GROUP BY j.id`,
      [delivery.deliveryId],
    );
    assert.deepEqual(balance.rows[0], {
      debit: "2900", credit: "2900", declared_debit_satang: "2900", declared_credit_satang: "2900",
    });

    const appClient = await appPool.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', $1, true)", [tenantRef]);
      const posted = await appClient.query<{ journal_id: string; account_id: string }>(
        `SELECT j.id AS journal_id, min(e.account_id::text)::uuid AS account_id
           FROM fleet_delivery.ledger_journals j
           JOIN fleet_delivery.ledger_entries e ON e.journal_id=j.id
          WHERE j.delivery_id=$1 GROUP BY j.id`,
        [delivery.deliveryId],
      );
      await appClient.query("SAVEPOINT immutable_check");
      await assert.rejects(
        () => appClient.query(
          "UPDATE fleet_delivery.ledger_journals SET declared_debit_satang=3000 WHERE id=$1",
          [posted.rows[0]!.journal_id],
        ),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "55000"),
      );
      await appClient.query("ROLLBACK TO SAVEPOINT immutable_check");
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', $1, true)", [tenantRef]);
      await appClient.query("SAVEPOINT unsupported_finance_account");
      await assert.rejects(
        () => appClient.query(
          `INSERT INTO fleet_delivery.ledger_accounts (
             tenant_ref, code, name, account_type, currency
           ) VALUES ($1, 'DRIVER_EARNING_PAYABLE', 'Forbidden before finance approval', 'LIABILITY', 'THB')`,
          [tenantRef],
        ),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
      );
      await appClient.query("ROLLBACK TO SAVEPOINT unsupported_finance_account");
      await appClient.query("SAVEPOINT mismatched_shadow_account");
      await assert.rejects(
        () => appClient.query(
          `INSERT INTO fleet_delivery.ledger_accounts (
             tenant_ref, code, name, account_type, currency
           ) VALUES ($1, 'DELIVERY_FEE_CLEARING', 'Wrong account type', 'LIABILITY', 'THB')`,
          [tenantRef],
        ),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
      );
      await appClient.query("ROLLBACK TO SAVEPOINT mismatched_shadow_account");
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', $1, true)", [tenantRef]);
      const unbalancedId = randomUUID();
      await appClient.query(
        `INSERT INTO fleet_delivery.ledger_journals (
           id, tenant_ref, branch_ref, delivery_id, journal_type, source_event_ref, currency,
           status, declared_debit_satang, declared_credit_satang, effective_at
         ) VALUES ($1,$2,$3,$4,'DELIVERY_FEE_ALLOCATION_SHADOW',$5,'THB','DRAFT',100,100,now())`,
        [unbalancedId, tenantRef, branchRef, delivery.deliveryId, `unbalanced:${unbalancedId}`],
      );
      await appClient.query(
        `INSERT INTO fleet_delivery.ledger_entries (
           tenant_ref, journal_id, account_id, side, amount_satang, memo
         ) VALUES ($1,$2,$3,'DEBIT',100,'intentional test imbalance')`,
        [tenantRef, unbalancedId, posted.rows[0]!.account_id],
      );
      await appClient.query(
        "UPDATE fleet_delivery.ledger_journals SET status='POSTED', posted_at=now() WHERE id=$1",
        [unbalancedId],
      );
      await assert.rejects(
        () => appClient.query("COMMIT"),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
      );
      await appClient.query("ROLLBACK").catch(() => undefined);

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', 'tenant:other', true)");
      const invisible = await appClient.query(
        "SELECT count(*)::int AS count FROM fleet_delivery.deliveries WHERE id=$1",
        [delivery.deliveryId],
      );
      assert.equal(invisible.rows[0]?.count, 0);
      await appClient.query("ROLLBACK");
    } finally {
      appClient.release();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const tables = [
      "notification_intents", "delivery_disputes", "delivery_returns", "delivery_failures",
      "synthetic_pod_evidence",
      "ledger_entries", "ledger_journals", "ledger_accounts", "delivery_state_transitions",
      "deliveries", "quote_components", "delivery_quotes", "customer_grants", "order_context_snapshots",
      "pricing_rules", "service_areas", "merchant_configurations", "outbox_events",
      "idempotency_keys", "audit_logs", "inbox_events",
    ];
    await ownerPool.query("SET session_replication_role = replica");
    try {
      for (const table of tables) {
        await ownerPool.query(`DELETE FROM fleet_delivery.${table} WHERE tenant_ref = $1`, [tenantRef]).catch(() => undefined);
      }
    } finally {
      await ownerPool.query("SET session_replication_role = origin");
    }
    await ownerPool.query("DELETE FROM fleet_delivery.integration_mappings WHERE principal_subject=$1", [principal]);
    await Promise.allSettled([appPool.end(), ownerPool.end(), redis.quit()]);
  }
});
