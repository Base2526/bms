import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  orderContextEnvelopeV1Schema,
  type CreateDeliveryV1,
  type CreateQuoteV1,
  type DeliveryAction,
  type IntegrationEnvelopeV1,
  type MerchantConfigurationV1,
  type ReconciliationIssueFeedV1,
  type ReconciliationIssueQueryV1,
  type TransitionDeliveryV1,
} from "@bms/fleet-delivery-contracts";
import {
  calculateQuotePricing,
  isOpenAt,
  nextDeliveryState,
  requestFingerprint,
  type DeliveryState,
  type JsonValue,
} from "@bms/fleet-delivery-domain";
import { withTenantReadSnapshot, withTenantTransaction } from "./transaction.js";

export class FleetDeliveryBusinessError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(code);
  }
}

export type IdempotentResponse = { status: number; body: Record<string, unknown> };

export async function beginIdempotent(
  client: PoolClient,
  input: {
    tenantRef: string;
    principal: string;
    operation: string;
    key: string;
    request: JsonValue;
  },
): Promise<{ fingerprint: string; replay?: IdempotentResponse }> {
  const fingerprint = requestFingerprint(input.request);
  const inserted = await client.query(
    `INSERT INTO fleet_delivery.idempotency_keys (
       tenant_ref, principal_subject, operation, idempotency_key, request_sha256, status, expires_at
     ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.tenantRef, input.principal, input.operation, input.key, fingerprint],
  );
  if (inserted.rowCount === 1) return { fingerprint };
  const existing = await client.query<{
    request_sha256: string;
    status: string;
    response_status: number | null;
    response_body: Record<string, unknown> | null;
  }>(
    `SELECT request_sha256, status, response_status, response_body
       FROM fleet_delivery.idempotency_keys
      WHERE tenant_ref=$1 AND principal_subject=$2 AND operation=$3 AND idempotency_key=$4
      FOR UPDATE`,
    [input.tenantRef, input.principal, input.operation, input.key],
  );
  const row = existing.rows[0];
  if (!row || row.request_sha256 !== fingerprint) {
    throw new FleetDeliveryBusinessError("IDEMPOTENCY_BODY_MISMATCH", 409);
  }
  if (row.status === "SUCCEEDED" && row.response_status && row.response_body) {
    return { fingerprint, replay: { status: row.response_status, body: row.response_body } };
  }
  throw new FleetDeliveryBusinessError("IDEMPOTENCY_IN_PROGRESS", 409, true);
}

export async function finishIdempotent(
  client: PoolClient,
  input: { tenantRef: string; principal: string; operation: string; key: string },
  response: IdempotentResponse,
): Promise<void> {
  await client.query(
    `UPDATE fleet_delivery.idempotency_keys
        SET status='SUCCEEDED', response_status=$5, response_body=$6::jsonb
      WHERE tenant_ref=$1 AND principal_subject=$2 AND operation=$3 AND idempotency_key=$4`,
    [input.tenantRef, input.principal, input.operation, input.key, response.status, JSON.stringify(response.body)],
  );
}

export async function writeAudit(
  client: PoolClient,
  input: {
    tenantRef: string;
    branchRef: string;
    principal: string;
    actorType?: "SERVICE" | "DRIVER";
    action: string;
    targetType: string;
    targetRef: string;
    requestId: string;
    outcome?: "SUCCEEDED" | "DENIED";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO fleet_delivery.audit_logs (
       tenant_ref, branch_ref, actor_type, actor_ref, action, target_type, target_ref,
       request_id, outcome, safe_metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [input.tenantRef, input.branchRef, input.actorType ?? "SERVICE", input.principal, input.action,
      input.targetType, input.targetRef, input.requestId, input.outcome ?? "SUCCEEDED",
      JSON.stringify(input.metadata ?? {})],
  );
}

export async function writeOutbox(
  client: PoolClient,
  input: {
    tenantRef: string;
    branchRef: string;
    messageType: string;
    aggregateType: string;
    aggregateRef: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    correlationId: string;
  },
): Promise<void> {
  const messageId = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = {
    messageId,
    messageType: input.messageType,
    schemaVersion: 1,
    producer: "fleet-delivery",
    tenantRef: input.tenantRef,
    branchRef: input.branchRef,
    aggregateType: input.aggregateType,
    aggregateRef: input.aggregateRef,
    aggregateVersion: input.aggregateVersion,
    occurredAt,
    correlationId: input.correlationId,
    causationId: null,
    payload: input.payload,
  };
  await client.query(
    `INSERT INTO fleet_delivery.outbox_events (
       id, tenant_ref, branch_ref, message_type, aggregate_type, aggregate_ref,
       aggregate_version, destination, envelope
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'synthetic://ack',$8::jsonb)`,
    [messageId, input.tenantRef, input.branchRef, input.messageType, input.aggregateType,
      input.aggregateRef, input.aggregateVersion, JSON.stringify(envelope)],
  );
}

export async function principalHasTenantBranchMapping(
  pool: Pool,
  principal: string,
  tenantRef: string,
  branchRef: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM fleet_delivery.integration_mappings
      WHERE principal_subject=$1 AND external_tenant_ref=$2 AND external_branch_ref=$3 AND active=true LIMIT 1`,
    [principal, tenantRef, branchRef],
  );
  return result.rowCount === 1;
}

export async function configureMerchant(
  pool: Pool,
  input: MerchantConfigurationV1,
  context: { principal: string; idempotencyKey: string; requestId: string },
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "merchant.configure.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
      request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
      [input.tenantRef, input.branchRef],
    );
    const latest = await client.query<{ version: string }>(
      `SELECT version FROM fleet_delivery.merchant_configurations
        WHERE tenant_ref=$1 AND branch_ref=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [input.tenantRef, input.branchRef],
    );
    if (latest.rows[0] && BigInt(latest.rows[0].version) >= BigInt(input.version)) {
      throw new FleetDeliveryBusinessError("CONFIGURATION_VERSION_STALE", 409);
    }
    await client.query(
      `UPDATE fleet_delivery.merchant_configurations SET active=false
        WHERE tenant_ref=$1 AND branch_ref=$2 AND active=true`,
      [input.tenantRef, input.branchRef],
    );
    const configuration = await client.query<{ id: string }>(
      `INSERT INTO fleet_delivery.merchant_configurations (
         tenant_ref, branch_ref, version, enabled, timezone, readiness_policy,
         weekly_hours, quote_ttl_seconds, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
      [input.tenantRef, input.branchRef, input.version, input.enabled, input.timezone,
        input.readinessPolicy, JSON.stringify(input.weeklyHours), input.quoteTtlSeconds, context.principal],
    );
    const configurationId = configuration.rows[0]!.id;
    try {
      await client.query(
        `INSERT INTO fleet_delivery.service_areas (
           tenant_ref, branch_ref, configuration_id, name, area
         ) VALUES ($1,$2,$3,$4,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
        [input.tenantRef, input.branchRef, configurationId, input.serviceArea.name,
          JSON.stringify(input.serviceArea.geoJson)],
      );
    } catch (error) {
      throw new FleetDeliveryBusinessError("INVALID_SERVICE_AREA", 400);
    }
    await client.query(
      `INSERT INTO fleet_delivery.pricing_rules (
         tenant_ref, branch_ref, configuration_id, rule_version, currency,
         base_fare_satang, per_started_km_satang, minimum_fare_satang,
         fixed_merchant_subsidy_satang, commission_bps
       ) VALUES ($1,$2,$3,$4,'THB',$5,$6,$7,$8,$9)`,
      [input.tenantRef, input.branchRef, configurationId, input.pricing.ruleVersion,
        input.pricing.baseFareSatang, input.pricing.perStartedKmSatang,
        input.pricing.minimumFareSatang, input.pricing.fixedMerchantSubsidySatang,
        input.pricing.commissionBps],
    );
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "merchant.configuration.activated", targetType: "merchant_configuration",
      targetRef: configurationId, requestId: context.requestId, metadata: { version: input.version },
    });
    const response = { status: 201, body: { configurationId, version: input.version } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function applyOrderContextEnvelope(
  client: PoolClient,
  envelope: IntegrationEnvelopeV1,
): Promise<"APPLIED" | "STALE" | "VERSION_GAP"> {
  if (
    !["bms.order-context-changed.v1", "bms.order-context-snapshot.v1"].includes(envelope.messageType)
    || envelope.aggregateType !== "bms-order"
  ) {
    return "STALE";
  }
  const checkedEnvelope = orderContextEnvelopeV1Schema.parse(envelope);
  const payload = checkedEnvelope.payload;
  const current = await client.query<{ order_version: string }>(
    `SELECT order_version FROM fleet_delivery.order_context_snapshots
      WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND current=true FOR UPDATE`,
    [envelope.tenantRef, envelope.branchRef, envelope.aggregateRef],
  );
  if (current.rows[0] && BigInt(current.rows[0].order_version) >= BigInt(envelope.aggregateVersion)) {
    await client.query(
      `UPDATE fleet_delivery.inbox_events
          SET status='ACTION_REQUIRED', result='{"reason":"STALE_ORDER_CONTEXT"}'::jsonb
        WHERE producer=$1 AND message_id=$2`,
      [envelope.producer, envelope.messageId],
    );
    return "STALE";
  }
  const currentVersion = current.rows[0] ? BigInt(current.rows[0].order_version) : 0n;
  const incomingVersion = BigInt(checkedEnvelope.aggregateVersion);
  if (
    checkedEnvelope.messageType === "bms.order-context-changed.v1"
    && incomingVersion !== currentVersion + 1n
  ) {
    await client.query(
      `UPDATE fleet_delivery.inbox_events
          SET status='ACTION_REQUIRED',
              result=jsonb_build_object(
                'reason','ORDER_CONTEXT_VERSION_GAP',
                'currentVersion',$3::bigint,
                'receivedVersion',$4::bigint,
                'requiredMessageType','bms.order-context-snapshot.v1'
              )
        WHERE producer=$1 AND message_id=$2`,
      [checkedEnvelope.producer, checkedEnvelope.messageId, currentVersion.toString(), incomingVersion.toString()],
    );
    return "VERSION_GAP";
  }
  await client.query(
    `UPDATE fleet_delivery.order_context_snapshots SET current=false
      WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND current=true`,
    [checkedEnvelope.tenantRef, checkedEnvelope.branchRef, checkedEnvelope.aggregateRef],
  );
  await client.query(
    `INSERT INTO fleet_delivery.order_context_snapshots (
       tenant_ref, branch_ref, bms_order_ref, order_version, fulfillment_type, payment_state,
       merchant_readiness, eligibility_version, eligibility_decision, eligibility_blockers,
       eligibility_evaluated_at, dropoff_point, geocode_confidence, route_provider,
       route_reference, route_distance_m, route_observed_at, source_message_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,
       ST_SetSRID(ST_MakePoint($12,$13),4326),$14,$15,$16,$17,$18,$19)`,
    [checkedEnvelope.tenantRef, checkedEnvelope.branchRef, checkedEnvelope.aggregateRef, checkedEnvelope.aggregateVersion,
      payload.fulfillmentType, payload.paymentState, payload.merchantReadiness,
      payload.eligibility.version, payload.eligibility.decision, JSON.stringify(payload.eligibility.blockers),
      payload.eligibility.evaluatedAt, payload.dropoff.longitude, payload.dropoff.latitude,
      payload.dropoff.confidence, payload.route.provider, payload.route.reference,
      payload.route.distanceMeters, payload.route.observedAt, checkedEnvelope.messageId],
  );
  await client.query(
    `UPDATE fleet_delivery.inbox_events
        SET status='APPLIED', result=jsonb_build_object('handler',$3::text)
      WHERE producer=$1 AND message_id=$2`,
    [checkedEnvelope.producer, checkedEnvelope.messageId,
      checkedEnvelope.messageType === "bms.order-context-snapshot.v1"
        ? "order-context-snapshot-v1"
        : "order-context-changed-v1"],
  );
  return "APPLIED";
}

function encodeReconciliationCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([receivedAt, id]), "utf8").toString("base64url");
}

function decodeReconciliationCursor(cursor: string | undefined): { receivedAt: string | null; id: string | null } {
  if (!cursor) return { receivedAt: null, id: null };
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2
      || typeof value[0] !== "string" || typeof value[1] !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(value[0])
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[1])) {
      throw new Error("invalid cursor");
    }
    if (!Number.isFinite(new Date(value[0]).getTime())) throw new Error("invalid cursor time");
    return { receivedAt: value[0], id: value[1] };
  } catch {
    throw new FleetDeliveryBusinessError("INVALID_RECONCILIATION_CURSOR", 422);
  }
}

function reconciliationReason(result: unknown): string {
  if (typeof result === "object" && result !== null && "reason" in result) {
    const reason = (result as { reason?: unknown }).reason;
    if (typeof reason === "string" && /^[A-Z0-9_:-]{1,120}$/.test(reason)) return reason;
  }
  return "UNKNOWN_ACTION_REQUIRED";
}

export async function listReconciliationIssues(
  pool: Pool,
  input: ReconciliationIssueQueryV1,
): Promise<ReconciliationIssueFeedV1> {
  return withTenantReadSnapshot(pool, input.tenantRef, async (client) => {
    const cursor = decodeReconciliationCursor(input.cursor);
    const result = await client.query<{
      id: string;
      message_type: string;
      aggregate_type: string;
      aggregate_ref: string;
      aggregate_version: string;
      result: unknown;
      received_at: Date;
      cursor_received_at: string;
    }>(
      `SELECT id, message_type, aggregate_type, aggregate_ref, aggregate_version, result, received_at,
              to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_received_at
         FROM fleet_delivery.inbox_events
        WHERE tenant_ref=$1 AND branch_ref=$2 AND status='ACTION_REQUIRED'
          AND ($3::timestamptz IS NULL OR (received_at, id) > ($3::timestamptz, $4::uuid))
        ORDER BY received_at ASC, id ASC
        LIMIT $5`,
      [input.tenantRef, input.branchRef, cursor.receivedAt, cursor.id, input.limit + 1],
    );
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      serverNow: new Date().toISOString(),
      issues: rows.map((row) => ({
        issueId: row.id,
        messageType: row.message_type,
        aggregateType: row.aggregate_type,
        aggregateRef: row.aggregate_ref,
        aggregateVersion: asSafeNumber(row.aggregate_version),
        reason: reconciliationReason(row.result),
        receivedAt: row.received_at.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeReconciliationCursor(last.cursor_received_at, last.id) : null,
    };
  });
}

type QuoteRow = {
  configuration_id: string;
  configuration_version: string;
  enabled: boolean;
  timezone: string;
  weekly_hours: Array<{ dayOfWeek: number; opensAt: string; closesAt: string }>;
  quote_ttl_seconds: number;
  service_area_contains: boolean;
  rule_version: string;
  base_fare_satang: string;
  per_started_km_satang: string;
  minimum_fare_satang: string;
  fixed_merchant_subsidy_satang: string;
  commission_bps: number;
  context_id: string;
  order_version: string;
  payment_state: string;
  eligibility_version: string;
  eligibility_decision: string;
  eligibility_evaluated_at: Date;
  geocode_confidence: string;
  route_provider: string;
  route_reference: string;
  route_distance_m: number;
  route_observed_at: Date;
};

export function asSafeNumber(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new FleetDeliveryBusinessError("AMOUNT_OUT_OF_RANGE", 422);
  return parsed;
}

export async function createQuote(
  pool: Pool,
  input: CreateQuoteV1,
  context: { principal: string; idempotencyKey: string; requestId: string; now?: Date },
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "quote.create.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const result = await client.query<QuoteRow>(
      `SELECT c.id AS configuration_id, c.version AS configuration_version, c.enabled,
              c.timezone, c.weekly_hours, c.quote_ttl_seconds,
              ST_Covers(a.area, o.dropoff_point) AS service_area_contains,
              p.rule_version, p.base_fare_satang, p.per_started_km_satang,
              p.minimum_fare_satang, p.fixed_merchant_subsidy_satang, p.commission_bps,
              o.id AS context_id, o.order_version, o.payment_state, o.eligibility_version,
              o.eligibility_decision, o.eligibility_evaluated_at, o.geocode_confidence,
              o.route_provider, o.route_reference, o.route_distance_m, o.route_observed_at
         FROM fleet_delivery.merchant_configurations c
         JOIN fleet_delivery.service_areas a ON a.configuration_id=c.id
         JOIN fleet_delivery.pricing_rules p ON p.configuration_id=c.id
         JOIN fleet_delivery.order_context_snapshots o
           ON o.tenant_ref=c.tenant_ref AND o.branch_ref=c.branch_ref
          AND o.bms_order_ref=$3 AND o.current=true
        WHERE c.tenant_ref=$1 AND c.branch_ref=$2 AND c.active=true
        FOR SHARE OF c, o`,
      [input.tenantRef, input.branchRef, input.bmsOrderRef],
    );
    const row = result.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("QUOTE_CONTEXT_NOT_FOUND", 404);
    const now = context.now ?? new Date();
    if (!row.enabled) throw new FleetDeliveryBusinessError("MERCHANT_DELIVERY_DISABLED", 409);
    if (!isOpenAt(row.weekly_hours, now, row.timezone)) throw new FleetDeliveryBusinessError("MERCHANT_CLOSED", 409);
    if (!row.service_area_contains) throw new FleetDeliveryBusinessError("OUTSIDE_SERVICE_AREA", 422);
    if (asSafeNumber(row.order_version) !== input.expectedOrderVersion) throw new FleetDeliveryBusinessError("ORDER_VERSION_STALE", 409);
    if (row.payment_state !== "UNPAID") throw new FleetDeliveryBusinessError("ORDER_NOT_QUOTEABLE", 409);
    if (row.eligibility_decision !== "ELIGIBLE") throw new FleetDeliveryBusinessError("ORDER_INELIGIBLE", 422);
    if (Number(row.geocode_confidence) < 0.8) throw new FleetDeliveryBusinessError("GEOCODE_CONFIDENCE_LOW", 422);
    if (row.eligibility_evaluated_at.getTime() - now.getTime() > 5 * 60_000) throw new FleetDeliveryBusinessError("ELIGIBILITY_TIME_INVALID", 409);
    if (row.route_observed_at.getTime() - now.getTime() > 5 * 60_000) throw new FleetDeliveryBusinessError("ROUTE_TIME_INVALID", 409);
    if (now.getTime() - row.eligibility_evaluated_at.getTime() > 15 * 60_000) throw new FleetDeliveryBusinessError("ELIGIBILITY_STALE", 409);
    if (now.getTime() - row.route_observed_at.getTime() > 15 * 60_000) throw new FleetDeliveryBusinessError("ROUTE_STALE", 409);
    const pricing = calculateQuotePricing({
      distanceMeters: row.route_distance_m,
      baseFareSatang: asSafeNumber(row.base_fare_satang),
      perStartedKmSatang: asSafeNumber(row.per_started_km_satang),
      minimumFareSatang: asSafeNumber(row.minimum_fare_satang),
      fixedMerchantSubsidySatang: asSafeNumber(row.fixed_merchant_subsidy_satang),
      commissionBps: row.commission_bps,
    });
    const quoteId = randomUUID();
    const expiresAt = new Date(now.getTime() + row.quote_ttl_seconds * 1_000);
    await client.query(
      `INSERT INTO fleet_delivery.delivery_quotes (
         id, tenant_ref, branch_ref, bms_order_ref, order_context_id, order_version,
         eligibility_version, configuration_version, pricing_rule_version, route_provider,
         route_reference, route_distance_m, billable_distance_m, currency, base_fare_satang,
         distance_charge_satang, gross_delivery_fee_satang, customer_contribution_satang,
         merchant_subsidy_satang, explicit_discount_satang, eligible_commission_fee_satang,
         commission_bps, commission_satang, distance_rounding, commission_rounding,
         created_by, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'THB',$14,$15,$16,$17,$18,$19,$20,$21,$22,
         'STARTED_KILOMETRE','HALF_UP_SATANG',$23,$24,$25)`,
      [quoteId, input.tenantRef, input.branchRef, input.bmsOrderRef, row.context_id,
        input.expectedOrderVersion, row.eligibility_version, asSafeNumber(row.configuration_version),
        row.rule_version, row.route_provider, row.route_reference, row.route_distance_m,
        pricing.billableDistanceMeters, pricing.baseFareSatang, pricing.distanceChargeSatang,
        pricing.grossDeliveryFeeSatang, pricing.customerContributionSatang,
        pricing.merchantSubsidySatang, pricing.explicitDiscountSatang,
        pricing.eligibleCommissionFeeSatang, row.commission_bps, pricing.commissionSatang,
        context.principal, now, expiresAt],
    );
    const components: Array<[string, number, Record<string, unknown>]> = [
      ["BASE_FARE", pricing.baseFareSatang, {}],
      ["DISTANCE_CHARGE", pricing.distanceChargeSatang, { startedKilometres: pricing.startedKilometres }],
      ["MERCHANT_SUBSIDY", pricing.merchantSubsidySatang, {}],
      ["EXPLICIT_DISCOUNT", pricing.explicitDiscountSatang, {}],
      ["PLATFORM_COMMISSION", pricing.commissionSatang, { commissionBps: row.commission_bps }],
    ];
    for (const [type, amount, calculation] of components) {
      await client.query(
        `INSERT INTO fleet_delivery.quote_components (tenant_ref, quote_id, component_type, amount_satang, calculation)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [input.tenantRef, quoteId, type, amount, JSON.stringify(calculation)],
      );
    }
    await writeOutbox(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef,
      messageType: "fleet-delivery.quote-issued.v1", aggregateType: "delivery-quote",
      aggregateRef: quoteId, aggregateVersion: 1, correlationId: context.requestId,
      payload: { quoteId, bmsOrderRef: input.bmsOrderRef, expiresAt: expiresAt.toISOString() },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "delivery.quote.created", targetType: "delivery_quote", targetRef: quoteId,
      requestId: context.requestId,
    });
    const response = { status: 201, body: {
      quoteId, currency: "THB", ...pricing, commissionBps: row.commission_bps,
      pricingRuleVersion: row.rule_version, eligibilityVersion: row.eligibility_version,
      expiresAt: expiresAt.toISOString(),
    } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

async function ensureAccount(
  client: PoolClient,
  tenantRef: string,
  code: string,
  name: string,
  accountType: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fleet_delivery.ledger_accounts (tenant_ref, code, name, account_type, currency)
     VALUES ($1,$2,$3,$4,'THB') ON CONFLICT (tenant_ref, code) DO NOTHING RETURNING id`,
    [tenantRef, code, name, accountType],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM fleet_delivery.ledger_accounts WHERE tenant_ref=$1 AND code=$2",
    [tenantRef, code],
  );
  if (!existing.rows[0]) throw new Error("LEDGER_ACCOUNT_NOT_FOUND");
  return existing.rows[0].id;
}

export async function createDelivery(
  pool: Pool,
  input: CreateDeliveryV1,
  context: { principal: string; idempotencyKey: string; requestId: string; now?: Date },
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "delivery.create.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const quoteResult = await client.query<{
      status: string; expires_at: Date; order_version: string; eligibility_version: string;
      gross_delivery_fee_satang: string; customer_contribution_satang: string;
      merchant_subsidy_satang: string; explicit_discount_satang: string;
      commission_bps: number; commission_satang: string;
    }>(
      `SELECT q.status, q.expires_at, q.order_version, q.eligibility_version,
              q.gross_delivery_fee_satang, q.customer_contribution_satang,
              q.merchant_subsidy_satang, q.explicit_discount_satang,
              q.commission_bps, q.commission_satang
         FROM fleet_delivery.delivery_quotes q
         JOIN fleet_delivery.order_context_snapshots o ON o.id=q.order_context_id
        WHERE q.id=$1 AND q.tenant_ref=$2 AND q.branch_ref=$3 AND q.bms_order_ref=$4
          AND o.current=true AND o.order_version=q.order_version
          AND o.eligibility_version=q.eligibility_version AND o.eligibility_decision='ELIGIBLE'
        FOR UPDATE OF q`,
      [input.quoteId, input.tenantRef, input.branchRef, input.bmsOrderRef],
    );
    const quote = quoteResult.rows[0];
    const now = context.now ?? new Date();
    if (!quote) throw new FleetDeliveryBusinessError("QUOTE_NOT_FOUND_OR_STALE", 404);
    if (quote.status !== "ISSUED") throw new FleetDeliveryBusinessError("QUOTE_ALREADY_BOUND", 409);
    if (quote.expires_at.getTime() <= now.getTime()) throw new FleetDeliveryBusinessError("QUOTE_EXPIRED", 409);
    const deliveryId = randomUUID();
    await client.query(
      `INSERT INTO fleet_delivery.deliveries (
         id, tenant_ref, branch_ref, bms_order_ref, quote_id, state, currency,
         gross_delivery_fee_satang, customer_contribution_satang, merchant_subsidy_satang,
         explicit_discount_satang, commission_bps, commission_satang, created_by
       ) VALUES ($1,$2,$3,$4,$5,'AWAITING_PAYMENT','THB',$6,$7,$8,$9,$10,$11,$12)`,
      [deliveryId, input.tenantRef, input.branchRef, input.bmsOrderRef, input.quoteId,
        quote.gross_delivery_fee_satang, quote.customer_contribution_satang,
        quote.merchant_subsidy_satang, quote.explicit_discount_satang,
        quote.commission_bps, quote.commission_satang, context.principal],
    );
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id
       ) VALUES ($1,$2,$3,NULL,'AWAITING_PAYMENT',NULL,1,'create','SERVICE',$4,'QUOTE_BOUND',$5,$6)`,
      [input.tenantRef, input.branchRef, deliveryId, context.principal, context.idempotencyKey, context.requestId],
    );
    await client.query(
      `UPDATE fleet_delivery.delivery_quotes SET status='BOUND', bound_at=$2 WHERE id=$1`,
      [input.quoteId, now],
    );
    const customerAmount = asSafeNumber(quote.customer_contribution_satang);
    const subsidyAmount = asSafeNumber(quote.merchant_subsidy_satang);
    const discountAmount = asSafeNumber(quote.explicit_discount_satang);
    const grossAmount = asSafeNumber(quote.gross_delivery_fee_satang);
    const accountSpecs: Array<[string, string, string, number, "DEBIT" | "CREDIT"]> = [
      ["CUSTOMER_DELIVERY_RECEIVABLE", "Customer delivery contribution receivable", "ASSET", customerAmount, "DEBIT"],
      ["MERCHANT_SUBSIDY_RECEIVABLE", "Merchant delivery subsidy receivable", "ASSET", subsidyAmount, "DEBIT"],
      ["PLATFORM_PROMOTION_EXPENSE", "Explicit delivery discount", "EXPENSE", discountAmount, "DEBIT"],
      ["DELIVERY_FEE_CLEARING", "Delivery fee shadow clearing", "CLEARING", grossAmount, "CREDIT"],
    ];
    const journalId = randomUUID();
    await client.query(
      `INSERT INTO fleet_delivery.ledger_journals (
         id, tenant_ref, branch_ref, delivery_id, journal_type, source_event_ref, currency,
         status, declared_debit_satang, declared_credit_satang, effective_at
       ) VALUES ($1,$2,$3,$4,'DELIVERY_FEE_ALLOCATION_SHADOW',$5,'THB','DRAFT',$6,$6,$7)`,
      [journalId, input.tenantRef, input.branchRef, deliveryId, deliveryId, grossAmount, now],
    );
    for (const [code, name, type, amount, side] of accountSpecs) {
      if (amount === 0) continue;
      const accountId = await ensureAccount(client, input.tenantRef, code, name, type);
      await client.query(
        `INSERT INTO fleet_delivery.ledger_entries (tenant_ref, journal_id, account_id, side, amount_satang, memo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tenantRef, journalId, accountId, side, amount, `Delivery ${deliveryId}`],
      );
    }
    await client.query(
      `UPDATE fleet_delivery.ledger_journals SET status='POSTED', posted_at=$2 WHERE id=$1`,
      [journalId, now],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef,
      messageType: "fleet-delivery.delivery-created.v1", aggregateType: "delivery",
      aggregateRef: deliveryId, aggregateVersion: 1, correlationId: context.requestId,
      payload: { deliveryId, bmsOrderRef: input.bmsOrderRef, quoteId: input.quoteId, state: "AWAITING_PAYMENT" },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "delivery.created", targetType: "delivery", targetRef: deliveryId,
      requestId: context.requestId, metadata: { quoteId: input.quoteId, journalId },
    });
    const response = { status: 201, body: { deliveryId, state: "AWAITING_PAYMENT", version: 1, quoteId: input.quoteId } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function transitionDelivery(
  pool: Pool,
  deliveryId: string,
  action: DeliveryAction,
  input: TransitionDeliveryV1,
  context: { principal: string; idempotencyKey: string; requestId: string; now?: Date },
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = `delivery.transition.${action}.v1`;
    const request = { deliveryId, action, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request,
    });
    if (idem.replay) return idem.replay;
    const result = await client.query<{ state: DeliveryState; version: string }>(
      `SELECT state, version FROM fleet_delivery.deliveries
        WHERE id=$1 AND tenant_ref=$2 AND branch_ref=$3 FOR UPDATE`,
      [deliveryId, input.tenantRef, input.branchRef],
    );
    const delivery = result.rows[0];
    if (!delivery) throw new FleetDeliveryBusinessError("DELIVERY_NOT_FOUND", 404);
    const currentVersion = asSafeNumber(delivery.version);
    if (currentVersion !== input.expectedVersion) throw new FleetDeliveryBusinessError("DELIVERY_VERSION_CONFLICT", 409);
    let target: DeliveryState;
    try {
      target = nextDeliveryState(delivery.state, action);
    } catch {
      throw new FleetDeliveryBusinessError("INVALID_DELIVERY_TRANSITION", 409);
    }
    const nextVersion = currentVersion + 1;
    const now = context.now ?? new Date();
    await client.query(
      `UPDATE fleet_delivery.deliveries
          SET state=$2::text,
              version=$3::bigint,
              updated_at=$4::timestamptz,
              terminal_at=CASE WHEN $2::text='CANCELLED' THEN $4::timestamptz ELSE NULL END
        WHERE id=$1`,
      [deliveryId, target, nextVersion, now],
    );
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SERVICE',$9,$10,$11,$12,$13)`,
      [input.tenantRef, input.branchRef, deliveryId, delivery.state, target, currentVersion,
        nextVersion, action, context.principal, input.reasonCode, context.idempotencyKey,
        context.requestId, now],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef,
      messageType: "fleet-delivery.delivery-state-changed.v1", aggregateType: "delivery",
      aggregateRef: deliveryId, aggregateVersion: nextVersion, correlationId: context.requestId,
      payload: { deliveryId, fromState: delivery.state, toState: target, action, reasonCode: input.reasonCode },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: `delivery.${action}`, targetType: "delivery", targetRef: deliveryId,
      requestId: context.requestId, metadata: { fromState: delivery.state, toState: target, version: nextVersion },
    });
    const response = { status: 200, body: { deliveryId, state: target, version: nextVersion } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}
