import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import {
  createDeliveryV1Schema,
  createQuoteV1Schema,
  dispatchPolicyV1Schema,
  deliveryActionSchema,
  deliveryIdSchema,
  driverAssignmentQueryV1Schema,
  driverAvailabilityV1Schema,
  driverJourneyActionSchema,
  driverJourneyV1Schema,
  driverLocationV1Schema,
  driverOfferFeedQueryV1Schema,
  FINANCE_CAPABILITIES_V1,
  financeCapabilitiesQueryV1Schema,
  financeCapabilitiesV1Schema,
  integrationEnvelopeV1Schema,
  merchantConfigurationV1Schema,
  offerDecisionSchema,
  offerDecisionV1Schema,
  operationsDeliveryListQueryV1Schema,
  operationsScopeQueryV1Schema,
  reconciliationIssueQueryV1Schema,
  startDispatchV1Schema,
  syntheticDriverV1Schema,
  transitionDeliveryV1Schema,
  type StructuredErrorBody,
} from "@bms/fleet-delivery-contracts";
import {
  applyOrderContextEnvelope,
  advanceDriverPickupJourney,
  configureDispatchPolicy,
  configureMerchant,
  configureSyntheticDriver,
  createDelivery,
  createQuote,
  decideDispatchOffer,
  FleetDeliveryBusinessError,
  getCurrentDriverAssignment,
  getDriverSnapshot,
  getOperationsOverview,
  principalHasMapping,
  principalHasTenantBranchMapping,
  recordDriverLocation,
  listDriverOffers,
  listOperationsDeliveries,
  listReconciliationIssues,
  setDriverAvailability,
  startDispatch,
  storeInboxEnvelope,
  transitionDelivery,
  withTenantTransaction,
} from "@bms/fleet-delivery-database";
import { requireIdempotencyKey } from "@bms/fleet-delivery-domain";
import { ServiceAuthError, type VerifiedServicePrincipal } from "./serviceAuth.js";

type VerifyServiceToken = (
  authorization: string | undefined,
  requiredScope: string,
) => Promise<VerifiedServicePrincipal>;

type Dependencies = {
  pool: Pool;
  redis: Redis;
  verifyServiceToken?: VerifyServiceToken;
  isDraining?: () => boolean;
  maxBodyBytes: number;
  serviceRateLimitPerMinute: number;
};

function requestId(req: IncomingMessage): string {
  const supplied = req.headers["x-request-id"];
  return typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function sendJson(res: ServerResponse, status: number, body: unknown, id: string): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": id,
  });
  res.end(data);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  id: string,
): void {
  const body: StructuredErrorBody = { error: { code, message, retryable, requestId: id } };
  sendJson(res, status, body, id);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function rateLimit(redis: Redis, key: string, limit: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60_000);
  const redisKey = `fleet-delivery:rate:${key}:${bucket}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, 120);
  return count <= limit;
}

class RequestFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable = false) {
    super(code);
  }
}

function requireJson(req: IncomingMessage): void {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new RequestFailure(415, "UNSUPPORTED_MEDIA_TYPE");
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

async function authenticateMutation(
  deps: Dependencies,
  req: IncomingMessage,
  scope: string,
): Promise<VerifiedServicePrincipal> {
  if (!deps.verifyServiceToken) throw new RequestFailure(503, "SERVICE_AUTH_NOT_CONFIGURED", true);
  const principal = await deps.verifyServiceToken(req.headers.authorization, scope);
  try {
    if (!(await rateLimit(deps.redis, principal.subject, deps.serviceRateLimitPerMinute))) {
      throw new RequestFailure(429, "RATE_LIMITED", true);
    }
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure(503, "RATE_LIMIT_UNAVAILABLE", true);
  }
  return principal;
}

async function requireMapping(
  deps: Dependencies,
  principal: string,
  tenantRef: string,
  branchRef: string,
): Promise<void> {
  if (!(await principalHasTenantBranchMapping(deps.pool, principal, tenantRef, branchRef))) {
    throw new FleetDeliveryBusinessError("MAPPING_NOT_FOUND", 404);
  }
}

export function createFleetDeliveryServer(deps: Dependencies) {
  const server = createServer(async (req, res) => {
    const id = requestId(req);
    const startedAt = Date.now();
    const pathname = new URL(req.url ?? "/", "http://fleet-delivery.local").pathname;
    try {
      if (req.method === "GET" && pathname === "/livez") {
        sendJson(res, 200, { ok: true }, id);
        return;
      }
      if (req.method === "GET" && pathname === "/readyz") {
        if (deps.isDraining?.()) {
          sendJson(res, 503, {
            ok: false,
            draining: true,
            components: { database: "skipped", redis: "skipped" },
          }, id);
          return;
        }
        const [database, redis] = await Promise.allSettled([
          deps.pool.query("SELECT 1"),
          deps.redis.ping(),
        ]);
        const ok = database.status === "fulfilled" && redis.status === "fulfilled";
        sendJson(res, ok ? 200 : 503, {
          ok,
          components: {
            database: database.status === "fulfilled" ? "ok" : "error",
            redis: redis.status === "fulfilled" ? "ok" : "error",
          },
        }, id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/integration/reconciliation/issues") {
        const principal = await authenticateMutation(deps, req, "reconciliation.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = reconciliationIssueQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        await requireMapping(deps, principal.subject, query.tenantRef, query.branchRef);
        const response = await listReconciliationIssues(deps.pool, query);
        sendJson(res, 200, response, id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/finance/capabilities") {
        const principal = await authenticateMutation(deps, req, "finance.capabilities.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = financeCapabilitiesQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        await requireMapping(deps, principal.subject, query.tenantRef, query.branchRef);
        sendJson(res, 200, financeCapabilitiesV1Schema.parse(FINANCE_CAPABILITIES_V1), id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/operations/overview") {
        const principal = await authenticateMutation(deps, req, "operations.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = operationsScopeQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        await requireMapping(deps, principal.subject, query.tenantRef, query.branchRef);
        sendJson(res, 200, await getOperationsOverview(deps.pool, query), id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/operations/deliveries") {
        const principal = await authenticateMutation(deps, req, "operations.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = operationsDeliveryListQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        await requireMapping(deps, principal.subject, query.tenantRef, query.branchRef);
        sendJson(res, 200, await listOperationsDeliveries(deps.pool, query), id);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/integration/events") {
        const principal = await authenticateMutation(deps, req, "events.ingest");
        requireJson(req);
        const envelope = integrationEnvelopeV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        if (!(await principalHasMapping(
          deps.pool,
          principal.subject,
          envelope.tenantRef,
          envelope.branchRef,
          envelope.producer,
        ))) {
          sendError(res, 404, "MAPPING_NOT_FOUND", "Integration mapping not found", false, id);
          return;
        }
        const result = await withTenantTransaction(deps.pool, envelope.tenantRef, async (client) => {
          const stored = await storeInboxEnvelope(client, envelope);
          const handler = stored === "STORED" ? await applyOrderContextEnvelope(client, envelope) : undefined;
          return { stored, handler };
        });
        const stored = result.stored;
        if (stored === "BODY_MISMATCH") {
          sendError(res, 409, "MESSAGE_BODY_MISMATCH", "Message identity was reused with a different body", false, id);
          return;
        }
        sendJson(res, stored === "STORED" ? 202 : 200, { status: stored, handler: result.handler }, id);
        return;
      }
      if (req.method === "PUT" && pathname === "/v1/merchant/configuration") {
        const principal = await authenticateMutation(deps, req, "merchant.settings.write");
        requireJson(req);
        const body = merchantConfigurationV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await configureMerchant(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/quotes") {
        const principal = await authenticateMutation(deps, req, "quotes.create");
        requireJson(req);
        const body = createQuoteV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await createQuote(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/deliveries") {
        const principal = await authenticateMutation(deps, req, "deliveries.create");
        requireJson(req);
        const body = createDeliveryV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await createDelivery(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "PUT" && pathname === "/v1/dispatch/policy") {
        const principal = await authenticateMutation(deps, req, "dispatch.manage");
        requireJson(req);
        const body = dispatchPolicyV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await configureDispatchPolicy(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "PUT" && pathname === "/v1/dispatch/drivers") {
        const principal = await authenticateMutation(deps, req, "dispatch.manage");
        requireJson(req);
        const body = syntheticDriverV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await configureSyntheticDriver(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/driver/availability") {
        const principal = await authenticateMutation(deps, req, "driver.availability.write");
        requireJson(req);
        const body = driverAvailabilityV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        const response = await setDriverAvailability(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/driver/locations") {
        const principal = await authenticateMutation(deps, req, "driver.location.write");
        requireJson(req);
        const body = driverLocationV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        const response = await recordDriverLocation(deps.pool, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/driver/offers") {
        const principal = await authenticateMutation(deps, req, "driver.offers.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = driverOfferFeedQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        const response = await listDriverOffers(deps.pool, query, principal.subject);
        sendJson(res, 200, response, id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/driver/assignments/current") {
        const principal = await authenticateMutation(deps, req, "driver.assignments.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = driverAssignmentQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        const response = await getCurrentDriverAssignment(deps.pool, query, principal.subject);
        sendJson(res, 200, response, id);
        return;
      }
      if (req.method === "GET" && pathname === "/v1/driver/snapshot") {
        const principal = await authenticateMutation(deps, req, "driver.snapshot.read");
        const url = new URL(req.url ?? "/", "http://fleet-delivery.local");
        const query = driverOfferFeedQueryV1Schema.parse(Object.fromEntries(url.searchParams));
        const response = await getDriverSnapshot(deps.pool, query, principal.subject);
        sendJson(res, 200, response, id);
        return;
      }
      const driverJourneyMatch = pathname.match(
        /^\/v1\/driver\/deliveries\/([0-9a-f-]{36})\/actions\/(start_pickup|arrive_pickup)$/,
      );
      if (req.method === "POST" && driverJourneyMatch) {
        const principal = await authenticateMutation(deps, req, "driver.journey.write");
        requireJson(req);
        const deliveryId = deliveryIdSchema.parse(driverJourneyMatch[1]);
        const action = driverJourneyActionSchema.parse(driverJourneyMatch[2]);
        const body = driverJourneyV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        const response = await advanceDriverPickupJourney(deps.pool, deliveryId, action, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      const startDispatchMatch = pathname.match(/^\/v1\/deliveries\/([0-9a-f-]{36})\/actions\/start_dispatch$/);
      if (req.method === "POST" && startDispatchMatch) {
        const principal = await authenticateMutation(deps, req, "dispatch.manage");
        requireJson(req);
        const deliveryId = deliveryIdSchema.parse(startDispatchMatch[1]);
        const body = startDispatchV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await startDispatch(deps.pool, deliveryId, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      const offerDecisionMatch = pathname.match(/^\/v1\/dispatch\/offers\/([0-9a-f-]{36})\/(accept|reject)$/);
      if (req.method === "POST" && offerDecisionMatch) {
        const principal = await authenticateMutation(deps, req, "driver.offers.decide");
        requireJson(req);
        const offerId = deliveryIdSchema.parse(offerDecisionMatch[1]);
        const decision = offerDecisionSchema.parse(offerDecisionMatch[2]);
        const body = offerDecisionV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        const response = await decideDispatchOffer(deps.pool, offerId, decision, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      const actionMatch = pathname.match(/^\/v1\/deliveries\/([0-9a-f-]{36})\/actions\/([a-z_]+)$/);
      if (req.method === "POST" && actionMatch) {
        const principal = await authenticateMutation(deps, req, "deliveries.transition");
        requireJson(req);
        const deliveryId = deliveryIdSchema.parse(actionMatch[1]);
        const action = deliveryActionSchema.parse(actionMatch[2]);
        const body = transitionDeliveryV1Schema.parse(await readJson(req, deps.maxBodyBytes));
        await requireMapping(deps, principal.subject, body.tenantRef, body.branchRef);
        const response = await transitionDelivery(deps.pool, deliveryId, action, body, {
          principal: principal.subject,
          idempotencyKey: requireIdempotencyKey(headerValue(req, "idempotency-key")),
          requestId: id,
        });
        sendJson(res, response.status, response.body, id);
        return;
      }
      sendError(res, 404, "NOT_FOUND", "Route not found", false, id);
    } catch (error) {
      if (error instanceof RequestFailure) {
        sendError(res, error.status, error.code, error.code, error.retryable, id);
      } else if (error instanceof FleetDeliveryBusinessError) {
        sendError(res, error.httpStatus, error.code, error.code, error.retryable, id);
      } else if (error instanceof ServiceAuthError) {
        const status = error.code === "AUTH_FORBIDDEN" ? 403 : 401;
        sendError(res, status, error.code, "Service authentication failed", false, id);
      } else if (error instanceof SyntaxError) {
        sendError(res, 400, "INVALID_JSON", "Request body is not valid JSON", false, id);
      } else if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
        sendError(res, 413, "BODY_TOO_LARGE", "Request body exceeds the configured limit", false, id);
      } else if (error instanceof Error && error.message === "INVALID_IDEMPOTENCY_KEY") {
        sendError(res, 400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required", false, id);
      } else if (error && typeof error === "object" && "issues" in error) {
        sendError(res, 400, "VALIDATION_FAILED", "Request body failed validation", false, id);
      } else {
        const databaseCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : undefined;
        console.error(JSON.stringify({
          level: "error",
          component: "fleet-delivery-api",
          requestId: id,
          code: "UNHANDLED_REQUEST_ERROR",
          ...(databaseCode ? { databaseCode } : {}),
        }));
        sendError(res, 500, "INTERNAL_ERROR", "Request failed", true, id);
      }
    } finally {
      console.log(JSON.stringify({ level: "info", component: "fleet-delivery-api", requestId: id, method: req.method, path: pathname, durationMs: Date.now() - startedAt }));
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 1_000;
  return server;
}
