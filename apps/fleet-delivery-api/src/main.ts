import { createDatabasePool, isServiceTokenRevoked } from "@bms/fleet-delivery-database";
import { createRedisClient, optionalPositiveInt, requiredEnv } from "@bms/fleet-delivery-shared";
import { createFleetDeliveryServer } from "./server.js";
import { createServiceTokenVerifier, parseJwksJson } from "./serviceAuth.js";

const databaseUrl = requiredEnv("FLEET_DELIVERY_DATABASE_URL");
const redisUrl = requiredEnv("FLEET_DELIVERY_REDIS_URL");
const port = optionalPositiveInt("FLEET_DELIVERY_API_PORT", 4100);
const shutdownTimeoutMs = optionalPositiveInt("FLEET_DELIVERY_SHUTDOWN_TIMEOUT_MS", 15_000);
const pool = createDatabasePool(databaseUrl, optionalPositiveInt("FLEET_DELIVERY_DB_POOL_MAX", 10));
const redis = createRedisClient(redisUrl);
await redis.connect();

const jwksJson = process.env.FLEET_DELIVERY_SERVICE_JWKS_JSON?.trim();
if (process.env.NODE_ENV === "production" && !jwksJson) requiredEnv("FLEET_DELIVERY_SERVICE_JWKS_JSON");
const issuer = process.env.FLEET_DELIVERY_SERVICE_ISSUER?.trim() || "";
const audience = process.env.FLEET_DELIVERY_SERVICE_AUDIENCE?.trim() || "";
if (process.env.NODE_ENV === "production") {
  requiredEnv("FLEET_DELIVERY_SERVICE_ISSUER");
  requiredEnv("FLEET_DELIVERY_SERVICE_AUDIENCE");
}
const verifyServiceToken = jwksJson && issuer && audience
  ? createServiceTokenVerifier({
      jwks: parseJwksJson(jwksJson),
      issuer,
      audience,
      isRevoked: (claims) => isServiceTokenRevoked(pool, claims),
    })
  : undefined;

let draining = false;
const server = createFleetDeliveryServer({
  pool,
  redis,
  ...(verifyServiceToken ? { verifyServiceToken } : {}),
  isDraining: () => draining,
  maxBodyBytes: optionalPositiveInt("FLEET_DELIVERY_MAX_BODY_BYTES", 65_536),
  serviceRateLimitPerMinute: optionalPositiveInt("FLEET_DELIVERY_SERVICE_RATE_LIMIT_PER_MINUTE", 120),
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", component: "fleet-delivery-api", event: "started", port }));
});

async function shutdown(signal: string): Promise<void> {
  if (draining) return;
  draining = true;
  console.log(JSON.stringify({ level: "info", component: "fleet-delivery-api", event: "shutdown", signal }));
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.error(JSON.stringify({
        level: "error",
        component: "fleet-delivery-api",
        event: "shutdown_timeout",
        timeoutMs: shutdownTimeoutMs,
      }));
      server.closeAllConnections();
      resolve();
    }, shutdownTimeoutMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
  await Promise.allSettled([pool.end(), redis.quit()]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal).then(() => process.exit(0)));
}
