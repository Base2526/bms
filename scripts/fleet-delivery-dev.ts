import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { Pool } from "pg";
import { z } from "zod";
import { CustomerDeliveryClient } from "../apps/fleet-delivery-customer-core/src/index.js";

const DEV_ISSUER = "fleet-delivery-local-dev";
const DEV_AUDIENCE = "fleet-delivery";
const AUTH_FILENAME = "dev-auth.json";
const LATEST_FILENAME = "latest-scenario.json";
const DRIVER_SCENARIO_NAME = "customer-delivery";
const CUSTOMER_SCENARIO_NAME = "customer-search";
const SYNTHETIC_TENANT_PREFIX = "tenant:dev-";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const composeDirectory = resolve(repositoryRoot, "infrastructure/fleet-delivery");
const composeFile = resolve(composeDirectory, "docker-compose.yml");
const envFile = resolve(composeDirectory, ".env");
const localDirectory = resolve(repositoryRoot, ".local/fleet-delivery");
const scenarioDirectory = resolve(localDirectory, "scenarios");
const authFile = resolve(localDirectory, AUTH_FILENAME);
const latestFile = resolve(localDirectory, LATEST_FILENAME);

const jwkSchema = z.record(z.string(), z.unknown());
const authFileSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("LOCAL_SYNTHETIC_ONLY"),
  issuer: z.literal(DEV_ISSUER),
  audience: z.literal(DEV_AUDIENCE),
  createdAt: z.iso.datetime({ offset: true }),
  publicJwk: jwkSchema,
  privateJwk: jwkSchema,
}).strict();

const driverActivationSchema = z.object({
  apiBaseUrl: z.string().url(),
  accessToken: z.string().min(16),
  tenantRef: z.string().startsWith(SYNTHETIC_TENANT_PREFIX),
  branchRef: z.literal("branch:main"),
}).strict();

const driverScenarioFileSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("LOCAL_SYNTHETIC_ONLY"),
  scenarioName: z.literal(DRIVER_SCENARIO_NAME),
  scenarioId: z.string().regex(/^customer-delivery-[0-9a-f-]{36}$/),
  createdAt: z.iso.datetime({ offset: true }),
  tokenExpiresAt: z.iso.datetime({ offset: true }),
  customerSurfaceAvailable: z.literal(false),
  state: z.literal("OFFERED"),
  driverActivation: driverActivationSchema,
  refs: z.object({
    adminPrincipal: z.string().min(1),
    driverPrincipal: z.string().min(1),
    driverRef: z.string().min(1),
    vehicleRef: z.string().min(1),
    bmsOrderRef: z.string().min(1),
    quoteId: z.uuid(),
    deliveryId: z.uuid(),
    dispatchAttemptId: z.uuid(),
    offerId: z.uuid(),
  }).strict(),
}).strict();

const customerActivationSchema = z.object({
  apiBaseUrl: z.string().url(),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  syntheticOnly: z.literal(true),
}).strict();

const customerScenarioFileSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("LOCAL_SYNTHETIC_ONLY"),
  scenarioName: z.literal(CUSTOMER_SCENARIO_NAME),
  scenarioId: z.string().regex(/^customer-search-[0-9a-f-]{36}$/),
  createdAt: z.iso.datetime({ offset: true }),
  tokenExpiresAt: z.iso.datetime({ offset: true }),
  customerSurfaceAvailable: z.literal(true),
  state: z.enum(["READY_FOR_QUOTE", "DELIVERY_CREATED", "ASSIGNED", "COMPLETED", "RETURN_RESOLVED"]),
  customerActivation: customerActivationSchema,
  refs: z.object({
    tenantRef: z.string().startsWith(SYNTHETIC_TENANT_PREFIX),
    adminPrincipal: z.string().min(1),
    bmsOrderRef: z.string().min(1),
    customerGrantId: z.uuid(),
    quoteId: z.uuid().optional(),
    deliveryId: z.uuid().optional(),
    driverRef: z.string().min(1).optional(),
    vehicleRef: z.string().min(1).optional(),
    offerId: z.uuid().optional(),
    assignmentId: z.uuid().optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.state !== "READY_FOR_QUOTE" && (!value.refs.quoteId || !value.refs.deliveryId)) {
    context.addIssue({ code: "custom", path: ["refs"], message: "completed flow requires quote and delivery" });
  }
  if (["ASSIGNED", "COMPLETED", "RETURN_RESOLVED"].includes(value.state)
    && (!value.refs.driverRef || !value.refs.vehicleRef || !value.refs.offerId || !value.refs.assignmentId)) {
    context.addIssue({ code: "custom", path: ["refs"], message: "assigned flow requires dispatch refs" });
  }
});

const scenarioFileSchema = z.union([driverScenarioFileSchema, customerScenarioFileSchema]);

type DevAuth = z.infer<typeof authFileSchema>;
type ScenarioFile = z.infer<typeof scenarioFileSchema>;

type LocalConfiguration = {
  apiBaseUrl: string;
  ownerDatabaseUrl: string;
};

export function parseEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("INVALID_LOCAL_ENV_LINE");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("INVALID_LOCAL_ENV_KEY");
    if ((value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (values.has(key)) throw new Error(`DUPLICATE_LOCAL_ENV_KEY:${key}`);
    values.set(key, value);
  }
  return values;
}

export function assertLoopbackHttpOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1"
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("DEV_API_MUST_BE_LOOPBACK_HTTP_ORIGIN");
  }
  return url.origin;
}

export function assertSyntheticTenantRef(value: string): void {
  if (!value.startsWith(SYNTHETIC_TENANT_PREFIX)) throw new Error("CLEANUP_REFUSES_NON_SYNTHETIC_TENANT");
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`LOCAL_ENV_MISSING:${key}`);
  if (value.toLowerCase().includes("change-me")) throw new Error(`LOCAL_ENV_PLACEHOLDER:${key}`);
  return value;
}

function localPort(values: Map<string, string>, key: string, fallback: number): number {
  const raw = values.get(key)?.trim() || String(fallback);
  if (!/^\d{2,5}$/.test(raw)) throw new Error(`LOCAL_ENV_INVALID_PORT:${key}`);
  const port = Number(raw);
  if (port < 1 || port > 65_535) throw new Error(`LOCAL_ENV_INVALID_PORT:${key}`);
  return port;
}

export function buildLocalConfiguration(values: Map<string, string>): LocalConfiguration {
  const database = required(values, "FLEET_DELIVERY_POSTGRES_DB");
  const owner = required(values, "FLEET_DELIVERY_POSTGRES_OWNER");
  const password = required(values, "FLEET_DELIVERY_POSTGRES_OWNER_PASSWORD");
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(database)) throw new Error("LOCAL_ENV_INVALID_DATABASE_NAME");
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(owner)) throw new Error("LOCAL_ENV_INVALID_OWNER_ROLE");
  const databasePort = localPort(values, "FLEET_DELIVERY_POSTGRES_HOST_PORT", 55_432);
  const apiPort = localPort(values, "FLEET_DELIVERY_API_HOST_PORT", 4_100);
  const ownerDatabaseUrl = new URL("postgresql://127.0.0.1");
  ownerDatabaseUrl.username = owner;
  ownerDatabaseUrl.password = password;
  ownerDatabaseUrl.port = String(databasePort);
  ownerDatabaseUrl.pathname = `/${database}`;
  return {
    apiBaseUrl: assertLoopbackHttpOrigin(`http://127.0.0.1:${apiPort}`),
    ownerDatabaseUrl: ownerDatabaseUrl.toString(),
  };
}

async function loadLocalConfiguration(): Promise<LocalConfiguration> {
  let text: string;
  try {
    text = await readFile(envFile, "utf8");
  } catch {
    throw new Error("LOCAL_ENV_NOT_FOUND: copy infrastructure/fleet-delivery/.env.example to .env first");
  }
  return buildLocalConfiguration(parseEnvText(text));
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function readDevAuth(): Promise<DevAuth> {
  try {
    return authFileSchema.parse(JSON.parse(await readFile(authFile, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("DEV_AUTH_INVALID");
    throw new Error("DEV_AUTH_MISSING: run npm run dev:bootstrap first");
  }
}

async function createDevAuth(): Promise<DevAuth> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const keyId = `fleet-delivery-dev-${randomUUID()}`;
  const [publicJwk, privateJwk] = await Promise.all([exportJWK(publicKey), exportJWK(privateKey)]);
  for (const jwk of [publicJwk, privateJwk]) {
    jwk.kid = keyId;
    jwk.alg = "EdDSA";
    jwk.use = "sig";
  }
  const auth = authFileSchema.parse({
    schemaVersion: 1,
    mode: "LOCAL_SYNTHETIC_ONLY",
    issuer: DEV_ISSUER,
    audience: DEV_AUDIENCE,
    createdAt: new Date().toISOString(),
    publicJwk,
    privateJwk,
  });
  await writePrivateJson(authFile, auth);
  return auth;
}

async function authOrCreate(): Promise<{ auth: DevAuth; reused: boolean }> {
  try {
    return { auth: await readDevAuth(), reused: true };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("DEV_AUTH_MISSING")) throw error;
    return { auth: await createDevAuth(), reused: false };
  }
}

async function runCommand(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`COMMAND_FAILED:${command}:${code ?? signal ?? "unknown"}`));
    });
  });
}

async function waitForReady(apiBaseUrl: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/readyz`, { signal: AbortSignal.timeout(2_000) });
      lastStatus = String(response.status);
      if (response.ok) return;
    } catch {
      lastStatus = "unreachable";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`DEV_STACK_NOT_READY:${lastStatus}`);
}

async function bootstrap(): Promise<void> {
  const configuration = await loadLocalConfiguration();
  const { auth, reused } = await authOrCreate();
  const composeEnvironment = {
    ...process.env,
    FLEET_DELIVERY_SERVICE_JWKS_JSON: JSON.stringify({ keys: [auth.publicJwk] }),
    FLEET_DELIVERY_SERVICE_ISSUER: auth.issuer,
    FLEET_DELIVERY_SERVICE_AUDIENCE: auth.audience,
  };
  await runCommand("docker", [
    "compose", "--env-file", envFile, "-f", composeFile, "up", "-d", "--build",
  ], composeEnvironment);
  await waitForReady(configuration.apiBaseUrl);
  process.stdout.write(`${JSON.stringify({
    mode: "LOCAL_SYNTHETIC_ONLY",
    ready: true,
    apiBaseUrl: configuration.apiBaseUrl,
    authKeyReused: reused,
    authFile: authFile.slice(repositoryRoot.length + 1),
    secretsPrinted: false,
    next: `npm run dev:scenario -- ${CUSTOMER_SCENARIO_NAME}`,
  }, null, 2)}\n`);
}

async function signToken(
  auth: DevAuth,
  subject: string,
  scopes: string[],
  expiration: Date,
): Promise<string> {
  const privateKey = await importJWK(auth.privateJwk as JWK, "EdDSA");
  return new SignJWT({ scopes })
    .setProtectedHeader({ alg: "EdDSA", kid: String(auth.privateJwk.kid) })
    .setIssuer(auth.issuer)
    .setAudience(auth.audience)
    .setSubject(subject)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiration.getTime() / 1_000))
    .sign(privateKey);
}

async function apiRequest<T>(input: {
  apiBaseUrl: string;
  token: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  idempotencyKey?: string;
  expected: number | number[];
}): Promise<T> {
  const expected = Array.isArray(input.expected) ? input.expected : [input.expected];
  const response = await fetch(`${input.apiBaseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      authorization: `Bearer ${input.token}`,
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const body = await response.json().catch(() => undefined) as unknown;
  if (!expected.includes(response.status)) {
    const code = body && typeof body === "object" && "error" in body
      && body.error && typeof body.error === "object" && "code" in body.error
      ? String(body.error.code)
      : "UNSTRUCTURED_ERROR";
    throw new Error(`DEV_SCENARIO_API_FAILED:${input.method ?? "GET"}:${input.path}:${response.status}:${code}`);
  }
  return body as T;
}

function scenarioPath(id: string): string {
  if (!/^customer-(delivery|search)-[0-9a-f-]{36}$/.test(id)) throw new Error("INVALID_SCENARIO_ID");
  return resolve(scenarioDirectory, `${id}.json`);
}

async function createCustomerDeliveryScenario(): Promise<void> {
  const configuration = await loadLocalConfiguration();
  await waitForReady(configuration.apiBaseUrl, 10_000);
  const auth = await readDevAuth();
  const suffix = randomUUID();
  const scenarioId = `${DRIVER_SCENARIO_NAME}-${suffix}`;
  const tenantRef = `${SYNTHETIC_TENANT_PREFIX}${suffix}`;
  const branchRef = "branch:main" as const;
  const adminPrincipal = `dev-admin:${suffix}`;
  const driverPrincipal = `dev-driver:${suffix}`;
  const driverRef = `driver:dev-${suffix}`;
  const vehicleRef = `vehicle:dev-${suffix}`;
  const bmsOrderRef = `order:dev-${suffix}`;
  const adminExpiration = new Date(Date.now() + 15 * 60_000);
  const driverExpiration = new Date(Date.now() + 60 * 60_000);
  const [adminToken, driverToken] = await Promise.all([
    signToken(auth, adminPrincipal, [
      "events.ingest", "merchant.settings.write", "quotes.create", "deliveries.create",
      "deliveries.transition", "dispatch.manage", "operations.read",
    ], adminExpiration),
    signToken(auth, driverPrincipal, [
      "driver.availability.write", "driver.location.write", "driver.offers.read",
      "driver.offers.decide", "driver.assignments.read", "driver.journey.write",
      "driver.snapshot.read",
    ], driverExpiration),
  ]);

  const ownerPool = new Pool({ connectionString: configuration.ownerDatabaseUrl, max: 2 });
  try {
    await ownerPool.query(
      `INSERT INTO fleet_delivery.integration_mappings (
         principal_subject, external_tenant_ref, external_branch_ref, allowed_producer
       ) VALUES ($1,$2,$3,'synthetic-test')`,
      [adminPrincipal, tenantRef, branchRef],
    );

    const weeklyHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek, opensAt: "00:00", closesAt: "23:59",
    }));
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/merchant/configuration",
      method: "PUT",
      idempotencyKey: `${scenarioId}-merchant`,
      expected: 201,
      body: {
        tenantRef, branchRef, version: 1, enabled: true, timezone: "Asia/Bangkok",
        readinessPolicy: "EXPLICIT", weeklyHours, quoteTtlSeconds: 1_800,
        serviceArea: {
          name: "Local synthetic Bangkok square",
          geoJson: {
            type: "Polygon",
            coordinates: [[[100.0, 13.0], [101.0, 13.0], [101.0, 14.0], [100.0, 14.0], [100.0, 13.0]]],
          },
        },
        pricing: {
          ruleVersion: `dev:${suffix}`, baseFareSatang: 1_500, perStartedKmSatang: 700,
          minimumFareSatang: 2_000, fixedMerchantSubsidySatang: 500, commissionBps: 500,
        },
      },
    });

    const now = new Date().toISOString();
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/integration/events",
      method: "POST",
      expected: 202,
      body: {
        messageId: randomUUID(), messageType: "bms.order-context-changed.v1", schemaVersion: 1,
        producer: "synthetic-test", tenantRef, branchRef, aggregateType: "bms-order",
        aggregateRef: bmsOrderRef, aggregateVersion: 1, occurredAt: now,
        correlationId: randomUUID(), causationId: null,
        payload: {
          fulfillmentType: "DELIVERY", paymentState: "UNPAID", merchantReadiness: "NOT_ACCEPTED",
          eligibility: { version: `dev:${suffix}`, decision: "ELIGIBLE", blockers: [], evaluatedAt: now },
          dropoff: { longitude: 100.5018, latitude: 13.7563, confidence: 0.99 },
          route: { provider: "synthetic", reference: `route:dev-${suffix}`, distanceMeters: 1_001, observedAt: now },
        },
      },
    });

    const quote = await apiRequest<{ quoteId: string }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/quotes",
      method: "POST",
      idempotencyKey: `${scenarioId}-quote`,
      expected: 201,
      body: {
        tenantRef, branchRef, bmsOrderRef, expectedOrderVersion: 1,
        serviceRequirement: {
          serviceType: "ON_DEMAND", requiredVehicleType: "MOTORCYCLE",
          requiredCapacityKg: 20, packageWeightKg: 12.5, packageSizeClass: "SMALL",
          specialHandling: [], requirementVersion: "dev-motorcycle:v1",
        },
      },
    });
    const delivery = await apiRequest<{ deliveryId: string; version: number }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/deliveries",
      method: "POST",
      idempotencyKey: `${scenarioId}-delivery`,
      expected: 201,
      body: { tenantRef, branchRef, bmsOrderRef, quoteId: quote.quoteId },
    });
    let version = delivery.version;
    for (const [action, reasonCode] of [
      ["payment_confirmed", "SYNTHETIC_PAYMENT_CONFIRMED"],
      ["merchant_accepted", "SYNTHETIC_MERCHANT_ACCEPTED"],
      ["merchant_ready", "SYNTHETIC_MERCHANT_READY"],
    ] as const) {
      const transitioned = await apiRequest<{ version: number }>({
        apiBaseUrl: configuration.apiBaseUrl,
        token: adminToken,
        path: `/v1/deliveries/${delivery.deliveryId}/actions/${action}`,
        method: "POST",
        idempotencyKey: `${scenarioId}-${action}`,
        expected: 200,
        body: { tenantRef, branchRef, expectedVersion: version, reasonCode },
      });
      version = transitioned.version;
    }

    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/dispatch/policy",
      method: "PUT",
      idempotencyKey: `${scenarioId}-dispatch-policy`,
      expected: 201,
      body: {
        tenantRef, branchRef, version: 1, pickup: { longitude: 100.5, latitude: 13.75 },
        initialRadiusM: 500, radiusIncrementM: 500, maximumRadiusM: 1_500,
        offerTtlSeconds: 300, maximumSearchSeconds: 600, driverCooldownSeconds: 0,
        locationFreshnessSeconds: 300, maximumLocationAccuracyM: 100,
        batchSize: 1, fairnessMode: "DISTANCE_THEN_LONGEST_IDLE",
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/dispatch/drivers",
      method: "PUT",
      idempotencyKey: `${scenarioId}-driver`,
      expected: 201,
      body: {
        tenantRef, branchRef, driverRef, principalSubject: driverPrincipal,
        verificationStatus: "VERIFIED", status: "ACTIVE",
        vehicle: { vehicleRef, type: "MOTORCYCLE", capacityKg: 50 },
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: "/v1/driver/availability",
      method: "POST",
      idempotencyKey: `${scenarioId}-online`,
      expected: 200,
      body: { tenantRef, branchRef, state: "ONLINE" },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: "/v1/driver/locations",
      method: "POST",
      idempotencyKey: `${scenarioId}-location-1`,
      expected: 202,
      body: {
        tenantRef, branchRef, sequence: 1, longitude: 100.502, latitude: 13.75,
        accuracyM: 12, deviceObservedAt: new Date().toISOString(), mockLocation: false,
      },
    });
    const dispatch = await apiRequest<{ attemptId: string }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: `/v1/deliveries/${delivery.deliveryId}/actions/start_dispatch`,
      method: "POST",
      idempotencyKey: `${scenarioId}-start-dispatch`,
      expected: 202,
      body: { tenantRef, branchRef, expectedVersion: version },
    });

    let offerId: string | undefined;
    const offerDeadline = Date.now() + 15_000;
    while (Date.now() < offerDeadline) {
      const snapshot = await apiRequest<{ offers: Array<{ offerId: string }> }>({
        apiBaseUrl: configuration.apiBaseUrl,
        token: driverToken,
        path: `/v1/driver/snapshot?${new URLSearchParams({ tenantRef, branchRef })}`,
        expected: 200,
      });
      offerId = snapshot.offers[0]?.offerId;
      if (offerId) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (!offerId) throw new Error("DEV_SCENARIO_OFFER_TIMEOUT");

    const manifest = scenarioFileSchema.parse({
      schemaVersion: 1,
      mode: "LOCAL_SYNTHETIC_ONLY",
      scenarioName: DRIVER_SCENARIO_NAME,
      scenarioId,
      createdAt: new Date().toISOString(),
      tokenExpiresAt: driverExpiration.toISOString(),
      customerSurfaceAvailable: false,
      state: "OFFERED",
      driverActivation: {
        apiBaseUrl: configuration.apiBaseUrl,
        accessToken: driverToken,
        tenantRef,
        branchRef,
      },
      refs: {
        adminPrincipal, driverPrincipal, driverRef, vehicleRef, bmsOrderRef,
        quoteId: quote.quoteId, deliveryId: delivery.deliveryId,
        dispatchAttemptId: dispatch.attemptId, offerId,
      },
    });
    const outputPath = scenarioPath(scenarioId);
    await writePrivateJson(outputPath, manifest);
    await writePrivateJson(latestFile, { scenarioId, manifest: outputPath.slice(repositoryRoot.length + 1) });
    process.stdout.write(`${JSON.stringify({
      mode: manifest.mode,
      scenarioId,
      state: manifest.state,
      vehicleType: "MOTORCYCLE",
      customerSurfaceAvailable: false,
      activationFile: outputPath.slice(repositoryRoot.length + 1),
      tokenPrinted: false,
      tokenExpiresAt: manifest.tokenExpiresAt,
      next: "Open the Debug Driver app and copy driverActivation fields from the protected activation file.",
      cleanup: `npm run dev:cleanup -- ${scenarioId}`,
    }, null, 2)}\n`);
  } catch (error) {
    await cleanupTenant(ownerPool, tenantRef).catch(() => undefined);
    throw error;
  } finally {
    await ownerPool.end();
  }
}

async function createCustomerSearchScenario(): Promise<void> {
  const configuration = await loadLocalConfiguration();
  await waitForReady(configuration.apiBaseUrl, 10_000);
  const auth = await readDevAuth();
  const suffix = randomUUID();
  const scenarioId = `${CUSTOMER_SCENARIO_NAME}-${suffix}`;
  const tenantRef = `${SYNTHETIC_TENANT_PREFIX}${suffix}`;
  const branchRef = "branch:main" as const;
  const adminPrincipal = `dev-admin:${suffix}`;
  const bmsOrderRef = `order:dev-${suffix}`;
  const customerGrantId = randomUUID();
  const tokenExpiresAt = new Date(Date.now() + 60 * 60_000);
  const customerToken = randomBytes(32).toString("base64url");
  const adminToken = await signToken(auth, adminPrincipal, [
    "events.ingest", "merchant.settings.write", "customer.grants.write",
  ], new Date(Date.now() + 15 * 60_000));
  const ownerPool = new Pool({ connectionString: configuration.ownerDatabaseUrl, max: 2 });
  try {
    await ownerPool.query(
      `INSERT INTO fleet_delivery.integration_mappings (
         principal_subject, external_tenant_ref, external_branch_ref, allowed_producer
       ) VALUES ($1,$2,$3,'synthetic-test')`,
      [adminPrincipal, tenantRef, branchRef],
    );
    const weeklyHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek, opensAt: "00:00", closesAt: "23:59",
    }));
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/merchant/configuration",
      method: "PUT",
      idempotencyKey: `${scenarioId}-merchant`,
      expected: 201,
      body: {
        tenantRef, branchRef, version: 1, enabled: true, timezone: "Asia/Bangkok",
        readinessPolicy: "EXPLICIT", weeklyHours, quoteTtlSeconds: 1_800,
        serviceArea: {
          name: "Local synthetic Bangkok square",
          geoJson: {
            type: "Polygon",
            coordinates: [[[100.0, 13.0], [101.0, 13.0], [101.0, 14.0], [100.0, 14.0], [100.0, 13.0]]],
          },
        },
        pricing: {
          ruleVersion: `dev:${suffix}`, baseFareSatang: 1_500, perStartedKmSatang: 700,
          minimumFareSatang: 2_000, fixedMerchantSubsidySatang: 500, commissionBps: 500,
        },
      },
    });
    const now = new Date().toISOString();
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/integration/events",
      method: "POST",
      expected: 202,
      body: {
        messageId: randomUUID(), messageType: "bms.order-context-changed.v1", schemaVersion: 1,
        producer: "synthetic-test", tenantRef, branchRef, aggregateType: "bms-order",
        aggregateRef: bmsOrderRef, aggregateVersion: 1, occurredAt: now,
        correlationId: randomUUID(), causationId: null,
        payload: {
          fulfillmentType: "DELIVERY", paymentState: "UNPAID", merchantReadiness: "NOT_ACCEPTED",
          eligibility: { version: `dev:${suffix}`, decision: "ELIGIBLE", blockers: [], evaluatedAt: now },
          dropoff: { longitude: 100.5018, latitude: 13.7563, confidence: 0.99 },
          route: { provider: "synthetic", reference: `route:dev-${suffix}`, distanceMeters: 1_001, observedAt: now },
        },
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/customer/grants",
      method: "POST",
      idempotencyKey: `${scenarioId}-grant`,
      expected: 201,
      body: {
        grantId: customerGrantId, tenantRef, branchRef, bmsOrderRef,
        tokenSha256: createHash("sha256").update(customerToken).digest("hex"),
        expiresAt: tokenExpiresAt.toISOString(),
        allowedActions: ["QUOTE", "CREATE_DELIVERY", "TRACK"],
        syntheticOnly: true,
      },
    });
    const manifest = customerScenarioFileSchema.parse({
      schemaVersion: 1,
      mode: "LOCAL_SYNTHETIC_ONLY",
      scenarioName: CUSTOMER_SCENARIO_NAME,
      scenarioId,
      createdAt: new Date().toISOString(),
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      customerSurfaceAvailable: true,
      state: "READY_FOR_QUOTE",
      customerActivation: {
        apiBaseUrl: configuration.apiBaseUrl,
        accessToken: customerToken,
        expiresAt: tokenExpiresAt.toISOString(),
        syntheticOnly: true,
      },
      refs: { tenantRef, adminPrincipal, bmsOrderRef, customerGrantId },
    });
    const outputPath = scenarioPath(scenarioId);
    await writePrivateJson(outputPath, manifest);
    await writePrivateJson(latestFile, { scenarioId, manifest: outputPath.slice(repositoryRoot.length + 1) });
    process.stdout.write(`${JSON.stringify({
      mode: manifest.mode,
      scenarioId,
      state: manifest.state,
      customerSurfaceAvailable: true,
      activationFile: outputPath.slice(repositoryRoot.length + 1),
      tokenPrinted: false,
      tokenExpiresAt: manifest.tokenExpiresAt,
      next: `npm run dev:customer-flow -- ${scenarioId}`,
      cleanup: `npm run dev:cleanup -- ${scenarioId}`,
    }, null, 2)}\n`);
  } catch (error) {
    await cleanupTenant(ownerPool, tenantRef).catch(() => undefined);
    throw error;
  } finally {
    await ownerPool.end();
  }
}

async function runCustomerFlow(id: string): Promise<void> {
  const path = scenarioPath(id);
  const manifest = customerScenarioFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (manifest.state !== "READY_FOR_QUOTE") throw new Error("CUSTOMER_FLOW_ALREADY_COMPLETED");
  const client = new CustomerDeliveryClient(manifest.customerActivation);
  const quote = await client.quote({
    serviceType: "ON_DEMAND",
    requiredVehicleType: "MOTORCYCLE",
    requiredCapacityKg: 20,
    packageWeightKg: 12.5,
    packageSizeClass: "SMALL",
    specialHandling: [],
    requirementVersion: "dev-customer-motorcycle:v1",
  }, `${id}-quote`);
  const delivery = await client.createDelivery(quote.quoteId, `${id}-delivery`);
  const completed = customerScenarioFileSchema.parse({
    ...manifest,
    state: "DELIVERY_CREATED",
    refs: { ...manifest.refs, quoteId: quote.quoteId, deliveryId: delivery.deliveryId },
  });
  await writePrivateJson(path, completed);
  process.stdout.write(`${JSON.stringify({
    mode: completed.mode,
    scenarioId: id,
    state: completed.state,
    quoteId: quote.quoteId,
    grossDeliveryFeeSatang: quote.grossDeliveryFeeSatang,
    customerContributionSatang: quote.customerContributionSatang,
    deliveryId: delivery.deliveryId,
    deliveryState: delivery.state,
    tokenPrinted: false,
    cleanup: `npm run dev:cleanup -- ${id}`,
  }, null, 2)}\n`);
}

async function advanceCustomerDispatch(id: string): Promise<void> {
  const path = scenarioPath(id);
  const manifest = customerScenarioFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (manifest.state === "ASSIGNED") throw new Error("CUSTOMER_DISPATCH_ALREADY_COMPLETED");
  if (new Date(manifest.tokenExpiresAt).getTime() <= Date.now()) throw new Error("CUSTOMER_SCENARIO_EXPIRED");
  const configuration = await loadLocalConfiguration();
  await waitForReady(configuration.apiBaseUrl, 10_000);
  const auth = await readDevAuth();
  const suffix = id.slice(`${CUSTOMER_SCENARIO_NAME}-`.length);
  const { tenantRef, adminPrincipal, bmsOrderRef } = manifest.refs;
  const branchRef = "branch:main" as const;
  const driverPrincipal = `dev-customer-driver:${suffix}`;
  const driverRef = `driver:customer-${suffix}`;
  const vehicleRef = `vehicle:customer-${suffix}`;
  const expiration = new Date(Date.now() + 15 * 60_000);
  const [adminToken, driverToken] = await Promise.all([
    signToken(auth, adminPrincipal, ["deliveries.transition", "dispatch.manage"], expiration),
    signToken(auth, driverPrincipal, [
      "driver.availability.write", "driver.location.write", "driver.offers.read",
      "driver.offers.decide", "driver.snapshot.read",
    ], expiration),
  ]);
  const ownerPool = new Pool({ connectionString: configuration.ownerDatabaseUrl, max: 1 });
  try {
    const deliveryResult = await ownerPool.query<{
      id: string;
      quote_id: string;
      state: string;
      version: string;
    }>(
      `SELECT id, quote_id, state, version
         FROM fleet_delivery.deliveries
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3
          AND fulfillment_kind='DELIVERY'
        LIMIT 1`,
      [tenantRef, branchRef, bmsOrderRef],
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) throw new Error("CUSTOMER_DELIVERY_NOT_CREATED: complete the app quote and confirmation first");
    if (delivery.state !== "AWAITING_PAYMENT" || Number(delivery.version) !== 1) {
      throw new Error(`CUSTOMER_DELIVERY_NOT_ADVANCEABLE:${delivery.state}:v${delivery.version}`);
    }

    let version = Number(delivery.version);
    for (const [action, reasonCode] of [
      ["payment_confirmed", "SYNTHETIC_PAYMENT_CONFIRMED"],
      ["merchant_accepted", "SYNTHETIC_MERCHANT_ACCEPTED"],
      ["merchant_ready", "SYNTHETIC_MERCHANT_READY"],
    ] as const) {
      const transitioned = await apiRequest<{ version: number }>({
        apiBaseUrl: configuration.apiBaseUrl,
        token: adminToken,
        path: `/v1/deliveries/${delivery.id}/actions/${action}`,
        method: "POST",
        idempotencyKey: `${id}-${action}`,
        expected: 200,
        body: { tenantRef, branchRef, expectedVersion: version, reasonCode },
      });
      version = transitioned.version;
    }

    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/dispatch/policy",
      method: "PUT",
      idempotencyKey: `${id}-dispatch-policy`,
      expected: 201,
      body: {
        tenantRef, branchRef, version: 1, pickup: { longitude: 100.5, latitude: 13.75 },
        initialRadiusM: 500, radiusIncrementM: 500, maximumRadiusM: 1_500,
        offerTtlSeconds: 300, maximumSearchSeconds: 600, driverCooldownSeconds: 0,
        locationFreshnessSeconds: 300, maximumLocationAccuracyM: 100,
        batchSize: 1, fairnessMode: "DISTANCE_THEN_LONGEST_IDLE",
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: "/v1/dispatch/drivers",
      method: "PUT",
      idempotencyKey: `${id}-driver`,
      expected: 201,
      body: {
        tenantRef, branchRef, driverRef, principalSubject: driverPrincipal,
        verificationStatus: "VERIFIED", status: "ACTIVE",
        vehicle: { vehicleRef, type: "MOTORCYCLE", capacityKg: 50 },
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: "/v1/driver/availability",
      method: "POST",
      idempotencyKey: `${id}-driver-online`,
      expected: 200,
      body: { tenantRef, branchRef, state: "ONLINE" },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: "/v1/driver/locations",
      method: "POST",
      idempotencyKey: `${id}-driver-location`,
      expected: 202,
      body: {
        tenantRef, branchRef, sequence: 1, longitude: 100.502, latitude: 13.75,
        accuracyM: 12, deviceObservedAt: new Date().toISOString(), mockLocation: false,
      },
    });
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: `/v1/deliveries/${delivery.id}/actions/start_dispatch`,
      method: "POST",
      idempotencyKey: `${id}-start-dispatch`,
      expected: 202,
      body: { tenantRef, branchRef, expectedVersion: version },
    });

    let offer: { offerId: string; version: number } | undefined;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const snapshot = await apiRequest<{ offers: Array<{ offerId: string; version: number }> }>({
        apiBaseUrl: configuration.apiBaseUrl,
        token: driverToken,
        path: `/v1/driver/snapshot?${new URLSearchParams({ tenantRef, branchRef })}`,
        expected: 200,
      });
      offer = snapshot.offers[0];
      if (offer) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (!offer) throw new Error("CUSTOMER_DISPATCH_OFFER_TIMEOUT");
    const accepted = await apiRequest<{ assignmentId: string }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: `/v1/dispatch/offers/${offer.offerId}/accept`,
      method: "POST",
      idempotencyKey: `${id}-accept-offer`,
      expected: 200,
      body: { tenantRef, branchRef, expectedOfferVersion: offer.version },
    });
    const customerProjection = await new CustomerDeliveryClient(
      manifest.customerActivation,
    ).getDeliveryStatus();
    if (customerProjection.delivery?.deliveryId !== delivery.id
      || customerProjection.delivery.state !== "ASSIGNED"
      || customerProjection.delivery.matchStage !== "DRIVER_ASSIGNED") {
      throw new Error("CUSTOMER_TRACKING_PROJECTION_DID_NOT_REACH_ASSIGNED");
    }

    const completed = customerScenarioFileSchema.parse({
      ...manifest,
      state: "ASSIGNED",
      refs: {
        ...manifest.refs,
        quoteId: delivery.quote_id,
        deliveryId: delivery.id,
        driverRef,
        vehicleRef,
        offerId: offer.offerId,
        assignmentId: accepted.assignmentId,
      },
    });
    await writePrivateJson(path, completed);
    process.stdout.write(`${JSON.stringify({
      mode: completed.mode,
      scenarioId: id,
      state: completed.state,
      deliveryId: delivery.id,
      deliveryState: "ASSIGNED",
      customerMatchStage: customerProjection.delivery.matchStage,
      customerVisibleVersion: customerProjection.delivery.version,
      vehicleType: "MOTORCYCLE",
      driverIdentityExposedToCustomer: false,
      tokenPrinted: false,
      next: "Tap Refresh status in the Customer App; it should show DRIVER_ASSIGNED.",
      cleanup: `npm run dev:cleanup -- ${id}`,
    }, null, 2)}\n`);
  } finally {
    await ownerPool.end();
  }
}

async function advanceCustomerPostAssignment(
  id: string,
  outcome: "COMPLETED" | "RETURN_RESOLVED",
): Promise<void> {
  const path = scenarioPath(id);
  const manifest = customerScenarioFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (manifest.state !== "ASSIGNED") throw new Error(`CUSTOMER_POST_ASSIGNMENT_REQUIRES_ASSIGNED:${manifest.state}`);
  if (new Date(manifest.tokenExpiresAt).getTime() <= Date.now()) throw new Error("CUSTOMER_SCENARIO_EXPIRED");
  const configuration = await loadLocalConfiguration();
  await waitForReady(configuration.apiBaseUrl, 10_000);
  const auth = await readDevAuth();
  const suffix = id.slice(`${CUSTOMER_SCENARIO_NAME}-`.length);
  const { tenantRef, adminPrincipal, deliveryId } = manifest.refs;
  if (!deliveryId) throw new Error("CUSTOMER_DELIVERY_NOT_CREATED");
  const branchRef = "branch:main" as const;
  const driverPrincipal = `dev-customer-driver:${suffix}`;
  const expiration = new Date(Date.now() + 15 * 60_000);
  const [adminToken, driverToken] = await Promise.all([
    signToken(auth, adminPrincipal, ["deliveries.transition"], expiration),
    signToken(auth, driverPrincipal, [
      "driver.journey.write", "driver.location.write", "driver.snapshot.read",
    ], expiration),
  ]);
  const query = new URLSearchParams({ tenantRef, branchRef });
  const snapshot = await apiRequest<{
    assignment: { deliveryId: string; deliveryVersion: number; deliveryState: string } | null;
  }>({
    apiBaseUrl: configuration.apiBaseUrl,
    token: driverToken,
    path: `/v1/driver/snapshot?${query}`,
    expected: 200,
  });
  if (snapshot.assignment?.deliveryId !== deliveryId || snapshot.assignment.deliveryState !== "ASSIGNED") {
    throw new Error("CUSTOMER_ACTIVE_ASSIGNMENT_NOT_FOUND");
  }
  let version = snapshot.assignment.deliveryVersion;
  const driverAction = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await apiRequest<{ version: number; state: string }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: `/v1/driver/deliveries/${deliveryId}/actions/${action}`,
      method: "POST",
      idempotencyKey: `${id}-${action}`,
      expected: 200,
      body: { tenantRef, branchRef, expectedVersion: version, ...extra },
    });
    version = response.version;
    return response.state;
  };
  const serviceAction = async (action: string, reasonCode: string) => {
    const response = await apiRequest<{ version: number; state: string }>({
      apiBaseUrl: configuration.apiBaseUrl,
      token: adminToken,
      path: `/v1/deliveries/${deliveryId}/actions/${action}`,
      method: "POST",
      idempotencyKey: `${id}-${action}`,
      expected: 200,
      body: { tenantRef, branchRef, expectedVersion: version, reasonCode },
    });
    version = response.version;
    return response.state;
  };
  const location = async (sequence: number, longitude: number, latitude: number, key: string) => {
    await apiRequest({
      apiBaseUrl: configuration.apiBaseUrl,
      token: driverToken,
      path: "/v1/driver/locations",
      method: "POST",
      idempotencyKey: `${id}-${key}`,
      expected: 202,
      body: {
        tenantRef, branchRef, sequence, longitude, latitude, accuracyM: 12,
        deviceObservedAt: new Date().toISOString(), mockLocation: false,
      },
    });
  };

  await driverAction("start_pickup");
  await location(2, 100.502, 13.75, "pickup-location");
  await driverAction("arrive_pickup");
  await serviceAction("merchant_handoff", "SYNTHETIC_MERCHANT_HANDOFF");
  await driverAction("start_delivery");

  if (outcome === "COMPLETED") {
    await location(3, 100.502, 13.75, "dropoff-location");
    await driverAction("arrive_dropoff");
    const proofSeed = `${id}:${deliveryId}:synthetic-pod`;
    await driverAction("deliver_with_pod", {
      pod: {
        evidenceRef: `synthetic-photo:${randomUUID()}`,
        sha256: createHash("sha256").update(proofSeed).digest("hex"),
        contentType: "image/jpeg",
        byteSize: Buffer.byteLength(proofSeed),
        pixelWidth: 1,
        pixelHeight: 1,
        syntheticOnly: true,
      },
    });
    await serviceAction("complete_delivery", "SYNTHETIC_BMS_COMPLETION_ACK");
  } else {
    await driverAction("report_failure", {
      failure: {
        reasonCode: "OTHER",
        safetyException: false,
        contactAttemptCount: 0,
        syntheticOnly: true,
      },
    });
    await serviceAction("request_return", "SYNTHETIC_RETURN_REQUESTED");
    await serviceAction("approve_return", "SYNTHETIC_RETURN_APPROVED");
    await driverAction("start_return");
    await location(3, 100.502, 13.75, "return-location");
    await driverAction("arrive_return");
    await serviceAction("review_return", "SYNTHETIC_RETURN_REVIEWED");
    await serviceAction("resolve_return", "SYNTHETIC_RETURN_RESOLVED");
  }

  const customerProjection = await new CustomerDeliveryClient(
    manifest.customerActivation,
  ).getDeliveryStatus();
  if (customerProjection.delivery?.deliveryId !== deliveryId
    || customerProjection.delivery.state !== outcome) {
    throw new Error(`CUSTOMER_TRACKING_PROJECTION_DID_NOT_REACH_${outcome}`);
  }
  const completed = customerScenarioFileSchema.parse({ ...manifest, state: outcome });
  await writePrivateJson(path, completed);
  process.stdout.write(`${JSON.stringify({
    mode: completed.mode,
    scenarioId: id,
    state: completed.state,
    deliveryId,
    deliveryState: customerProjection.delivery.state,
    customerMatchStage: customerProjection.delivery.matchStage,
    customerVisibleVersion: customerProjection.delivery.version,
    podBytesStored: false,
    preciseLocationExposedToCustomer: false,
    externalNotificationSent: false,
    realMoneyMoved: false,
    tokenPrinted: false,
    next: "Tap Refresh status in the Customer App to see the terminal synthetic state.",
    cleanup: `npm run dev:cleanup -- ${id}`,
  }, null, 2)}\n`);
}

const tenantTablesInDeleteOrder = [
  "notification_intents", "delivery_disputes", "delivery_returns", "delivery_failures",
  "synthetic_pod_evidence",
  "dispatch_manual_queue", "driver_assignments", "dispatch_offers", "dispatch_attempts",
  "driver_locations", "driver_availability", "driver_vehicles", "driver_memberships", "drivers",
  "dispatch_policy_versions", "ledger_entries", "ledger_journals", "ledger_accounts",
  "delivery_state_transitions", "deliveries", "quote_components", "delivery_quotes", "customer_grants",
  "order_context_snapshots", "service_areas", "pricing_rules", "merchant_configurations",
  "outbox_events", "idempotency_keys", "audit_logs", "inbox_events",
] as const;

async function cleanupTenant(pool: Pool, tenantRef: string): Promise<void> {
  assertSyntheticTenantRef(tenantRef);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of tenantTablesInDeleteOrder) {
      await client.query(`DELETE FROM fleet_delivery.${table} WHERE tenant_ref=$1`, [tenantRef]);
    }
    await client.query(
      "DELETE FROM fleet_delivery.integration_mappings WHERE external_tenant_ref=$1",
      [tenantRef],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupScenario(id: string): Promise<void> {
  const configuration = await loadLocalConfiguration();
  const path = scenarioPath(id);
  let manifest: ScenarioFile;
  try {
    manifest = scenarioFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("SCENARIO_MANIFEST_INVALID");
    throw new Error("SCENARIO_MANIFEST_NOT_FOUND");
  }
  const tenantRef = manifest.scenarioName === DRIVER_SCENARIO_NAME
    ? manifest.driverActivation.tenantRef
    : manifest.refs.tenantRef;
  assertSyntheticTenantRef(tenantRef);
  const pool = new Pool({ connectionString: configuration.ownerDatabaseUrl, max: 1 });
  try {
    await cleanupTenant(pool, tenantRef);
  } finally {
    await pool.end();
  }
  await rm(path, { force: true });
  try {
    const latest = JSON.parse(await readFile(latestFile, "utf8")) as { scenarioId?: unknown };
    if (latest.scenarioId === id) await rm(latestFile, { force: true });
  } catch {
    // Missing or unrelated latest pointer does not affect exact scenario cleanup.
  }
  process.stdout.write(`${JSON.stringify({
    mode: "LOCAL_SYNTHETIC_ONLY",
    scenarioId: id,
    removed: true,
    recoverable: false,
    scope: "exact synthetic tenant and local activation manifest",
  }, null, 2)}\n`);
}

async function listActiveScenarioIds(): Promise<string[]> {
  try {
    return (await readdir(scenarioDirectory))
      .filter((name) => /^customer-(delivery|search)-[0-9a-f-]{36}\.json$/.test(name))
      .map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (extra.length > 0) throw new Error("UNEXPECTED_ARGUMENTS");
  if (command === "bootstrap" && argument === undefined) {
    await bootstrap();
    return;
  }
  if (command === "scenario" && argument === DRIVER_SCENARIO_NAME) {
    await createCustomerDeliveryScenario();
    return;
  }
  if (command === "scenario" && argument === CUSTOMER_SCENARIO_NAME) {
    await createCustomerSearchScenario();
    return;
  }
  if (command === "customer-flow" && argument) {
    await runCustomerFlow(argument);
    return;
  }
  if (command === "customer-dispatch" && argument) {
    await advanceCustomerDispatch(argument);
    return;
  }
  if (command === "customer-complete" && argument) {
    await advanceCustomerPostAssignment(argument, "COMPLETED");
    return;
  }
  if (command === "customer-return" && argument) {
    await advanceCustomerPostAssignment(argument, "RETURN_RESOLVED");
    return;
  }
  if (command === "cleanup" && argument) {
    await cleanupScenario(argument);
    return;
  }
  const active = await listActiveScenarioIds();
  throw new Error(`USAGE: npm run dev:bootstrap | npm run dev:scenario -- ${CUSTOMER_SCENARIO_NAME}|${DRIVER_SCENARIO_NAME} | npm run dev:customer-flow -- <scenario-id> | npm run dev:customer-dispatch -- <scenario-id> | npm run dev:customer-complete -- <scenario-id> | npm run dev:customer-return -- <scenario-id> | npm run dev:cleanup -- <scenario-id>${active.length ? `; active=${active.join(",")}` : ""}`);
}

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => resolve(process.argv[1]!)) : "";
if (invokedPath === await realpath(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
