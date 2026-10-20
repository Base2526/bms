import { readFile } from "node:fs/promises";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import {
  createDatabasePool,
  runMigrations,
} from "@bms/fleet-delivery-database";
import { createRedisClient } from "@bms/fleet-delivery-shared";
import { RideSandboxService } from "../packages/fleet-delivery-database/src/rideSandbox.js";
import { createRideSandboxServer } from "../apps/fleet-delivery-api/src/rideSandboxServer.js";
import { buildLocalConfiguration, parseEnvText } from "./fleet-delivery-dev.js";
import {
  configureRideAndroidReverse,
  ensureRideInfrastructure,
  resolveRideProviderKey,
  stopPreviousRideSandbox,
} from "./fleet-delivery-ride-local.js";

if (process.env.NODE_ENV === "production")
  throw new Error("RIDE_SANDBOX_FORBIDDEN_IN_PRODUCTION");
// Keep the local server-key IP restriction stable: Node otherwise prefers a rotating IPv6
// privacy address while the operator explicitly whitelists the machine's public IPv4.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
const placesKey = resolveRideProviderKey(
  "BMS_RIDE_GOOGLE_PLACES_KEY",
  "Google Places server key",
);
const routesKey = resolveRideProviderKey(
  "BMS_RIDE_GOOGLE_ROUTES_KEY",
  "Google Routes server key",
);
ensureRideInfrastructure();
configureRideAndroidReverse();
await stopPreviousRideSandbox();
const env = parseEnvText(
  await readFile("infrastructure/fleet-delivery/.env", "utf8"),
);
const local = buildLocalConfiguration(env);
const owner = createDatabasePool(local.ownerDatabaseUrl);
try {
  const applied = await runMigrations(
    owner,
    "packages/fleet-delivery-database/migrations",
  );
  console.log(
    `Ride sandbox: ${applied.length} migrations applied (existing data preserved).`,
  );
} finally {
  await owner.end();
}
const appUrl = new URL(local.ownerDatabaseUrl);
appUrl.username = "fleet_delivery_app";
const password = env.get("FLEET_DELIVERY_APP_DB_PASSWORD");
if (!password) throw new Error("APP_DATABASE_PASSWORD_REQUIRED");
appUrl.password = password;
const pool = createDatabasePool(appUrl.toString());
const redis = createRedisClient(
  `redis://127.0.0.1:${env.get("FLEET_DELIVERY_REDIS_HOST_PORT") || "56379"}`,
);
await redis.connect();
const service = new RideSandboxService(pool, "sandbox:passenger-local");
await service.purgeLocations();
const server = createRideSandboxServer(service, redis, {
  placesKey,
  routesKey,
});
// Latest fix expires after 60s, removed within 90s while running; startup clears stopped-server residue.
const cleanup = setInterval(() => {
  void service
    .purgeLocations()
    .catch(() =>
      console.error(
        "Ride sandbox location cleanup failed; stale fixes remain excluded.",
      ),
    );
}, 30000);
cleanup.unref();
async function stop() {
  clearInterval(cleanup);
  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.allSettled([pool.end(), redis.quit()]);
}
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
try {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(4200, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  console.log(
    "Passenger sandbox ready: http://127.0.0.1:4200 (Google Places + Routes configured; local simulator payments only).",
  );
} catch (error) {
  await stop();
  throw error;
}
