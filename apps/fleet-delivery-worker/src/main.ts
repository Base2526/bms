import { randomUUID } from "node:crypto";
import {
  advanceDispatchAttempt,
  claimDispatchAttempts,
  claimOutbox,
  completeOutbox,
  createDatabasePool,
  failOutbox,
  type ClaimedOutboxEvent,
} from "@bms/fleet-delivery-database";
import { createRedisClient, optionalPositiveInt, requiredEnv } from "@bms/fleet-delivery-shared";

const workerId = `worker:${process.env.HOSTNAME?.trim() || "local"}:${randomUUID()}`;
const pool = createDatabasePool(requiredEnv("FLEET_DELIVERY_WORKER_DATABASE_URL"), 4);
const redis = createRedisClient(requiredEnv("FLEET_DELIVERY_REDIS_URL"));
const pollMs = optionalPositiveInt("FLEET_DELIVERY_OUTBOX_POLL_MS", 500);
const batchSize = optionalPositiveInt("FLEET_DELIVERY_OUTBOX_BATCH_SIZE", 25);
const leaseSeconds = optionalPositiveInt("FLEET_DELIVERY_OUTBOX_LEASE_SECONDS", 30);
const dispatchBatchSize = optionalPositiveInt("FLEET_DELIVERY_DISPATCH_BATCH_SIZE", 10);
const dispatchLeaseSeconds = optionalPositiveInt("FLEET_DELIVERY_DISPATCH_LEASE_SECONDS", 30);
let stopping = false;

await redis.connect();
await Promise.all([pool.query("SELECT 1"), redis.ping()]);
console.log(JSON.stringify({ level: "info", component: "fleet-delivery-worker", event: "started", workerId }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    console.log(JSON.stringify({ level: "info", component: "fleet-delivery-worker", event: "shutdown", signal, workerId }));
  });
}

async function handle(event: ClaimedOutboxEvent): Promise<void> {
  if (event.destination !== "synthetic://ack") {
    await failOutbox(pool, event.id, workerId, "DESTINATION_DISABLED", "Only synthetic://ack is enabled through Phase 3");
    return;
  }
  await completeOutbox(pool, event.id, workerId);
}

while (!stopping) {
  try {
    const attempts = await claimDispatchAttempts(pool, workerId, dispatchBatchSize, dispatchLeaseSeconds);
    for (const attempt of attempts) await advanceDispatchAttempt(pool, attempt.id, workerId);
  } catch {
    console.error(JSON.stringify({ level: "error", component: "fleet-delivery-worker", code: "DISPATCH_LOOP_FAILED", workerId }));
  }
  try {
    const events = await claimOutbox(pool, workerId, batchSize, leaseSeconds);
    for (const event of events) await handle(event);
  } catch {
    console.error(JSON.stringify({ level: "error", component: "fleet-delivery-worker", code: "OUTBOX_LOOP_FAILED", workerId }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollMs));
}
await Promise.allSettled([pool.end(), redis.quit()]);
