import assert from "node:assert/strict";
import test from "node:test";
import {
  DriverHttpTransport,
  DriverOfflineQueue,
  PHASE4_SAFE_CAPABILITIES,
  type DriverCommandStore,
  type DriverOfflineCommand,
} from "./index.js";

class MemoryStore implements DriverCommandStore {
  commands: DriverOfflineCommand[] = [];

  async load(): Promise<unknown> {
    return structuredClone(this.commands);
  }

  async save(commands: readonly DriverOfflineCommand[]): Promise<void> {
    this.commands = structuredClone([...commands]);
  }
}

const scope = { tenantRef: "tenant:synthetic", branchRef: "branch:main" };

test("offline retry preserves the original idempotency key and never claims success early", async () => {
  const store = new MemoryStore();
  const sent: DriverOfflineCommand[] = [];
  let attempt = 0;
  const queue = new DriverOfflineQueue(store, {
    async send(command) {
      sent.push(structuredClone(command));
      attempt += 1;
      return attempt === 1
        ? { outcome: "RETRYABLE_FAILURE", code: "NETWORK_UNAVAILABLE" }
        : { outcome: "APPLIED", response: { status: "ACCEPTED" } };
    },
  }, () => "command-offer-0001", () => new Date("2026-10-18T00:00:00Z"));

  const command = await queue.enqueueOfferDecision(
    scope,
    "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    "accept",
    1,
  );
  assert.equal(store.commands.length, 1);
  assert.equal((await queue.flush()).retryPending, true);
  assert.equal(store.commands.length, 1);
  const applied = await queue.flush();
  assert.deepEqual(applied.appliedCommandIds, [command.commandId]);
  assert.equal(store.commands.length, 0);
  assert.equal(sent[0]?.idempotencyKey, sent[1]?.idempotencyKey);
});

test("non-retryable server denial leaves the queue and remains visible to the UI", async () => {
  const store = new MemoryStore();
  const queue = new DriverOfflineQueue(store, {
    async send() {
      return { outcome: "REJECTED", code: "OFFER_ALREADY_DECIDED" };
    },
  }, () => "command-offer-0002", () => new Date("2026-10-18T00:00:00Z"));
  const command = await queue.enqueueOfferDecision(
    scope,
    "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    "accept",
    1,
  );
  const result = await queue.flush();
  assert.deepEqual(result.rejected, [{ commandId: command.commandId, code: "OFFER_ALREADY_DECIDED" }]);
  assert.equal(result.remaining, 0);
});

test("consecutive availability intent coalesces without crossing business commands", async () => {
  const store = new MemoryStore();
  let id = 0;
  const queue = new DriverOfflineQueue(store, {
    async send() {
      return { outcome: "APPLIED", response: {} };
    },
  }, () => `command-availability-${String(++id).padStart(4, "0")}`, () => new Date("2026-10-18T00:00:00Z"));

  const online = await queue.enqueueAvailability(scope, "ONLINE");
  const duplicateOnline = await queue.enqueueAvailability(scope, "ONLINE");
  assert.equal(duplicateOnline.idempotencyKey, online.idempotencyKey);
  const offline = await queue.enqueueAvailability(scope, "OFFLINE");
  assert.notEqual(offline.idempotencyKey, online.idempotencyKey);
  assert.equal(store.commands.length, 1);
  assert.equal(store.commands[0]?.kind, "SET_AVAILABILITY");
  assert.equal(store.commands[0]?.kind === "SET_AVAILABILITY" && store.commands[0].state, "OFFLINE");

  await queue.enqueueOfferDecision(
    scope,
    "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    "reject",
    1,
  );
  await queue.enqueueAvailability(scope, "ONLINE");
  assert.deepEqual(store.commands.map((command) => command.kind), [
    "SET_AVAILABILITY",
    "DECIDE_OFFER",
    "SET_AVAILABILITY",
  ]);
});

test("HTTP transport uses server offer authority and validates the privacy-minimal feed", async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "synthetic-token", async (url, init) => {
    requests.push({ url, headers: init.headers });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          serverNow: "2026-10-18T00:00:00.000Z",
          offers: [{
            offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
            deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
            status: "PENDING",
            version: 1,
            offeredAt: "2026-10-18T00:00:00.000Z",
            expiresAt: "2026-10-18T00:00:30.000Z",
            pickupDistanceM: 350,
          }],
        };
      },
    };
  });
  const feed = await transport.listOffers(scope);
  assert.equal(feed.offers[0]?.pickupDistanceM, 350);
  assert.match(requests[0]!.url, /tenantRef=tenant%3Asynthetic/);
  assert.equal(requests[0]!.headers.authorization, "Bearer synthetic-token");
});

test("authentication expiry keeps an offline command for reauthentication", async () => {
  const store = new MemoryStore();
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "expired-token", async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: { code: "AUTH_INVALID", retryable: false } };
    },
  }));
  const queue = new DriverOfflineQueue(
    store,
    transport,
    () => "command-availability-0001",
    () => new Date("2026-10-18T00:00:00Z"),
  );
  await queue.enqueueAvailability(scope, "ONLINE");
  const result = await queue.flush();
  assert.equal(result.retryPending, true);
  assert.equal(result.remaining, 1);
  assert.equal(store.commands.length, 1);
});

test("pickup journey action is replay-safe and carries no coordinates", async () => {
  const store = new MemoryStore();
  const requests: Array<{ url: string; body?: string; key?: string }> = [];
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "synthetic-token", async (url, init) => {
    requests.push({
      url,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers["idempotency-key"] ? { key: init.headers["idempotency-key"] } : {}),
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return { state: "EN_ROUTE_PICKUP", version: 7 };
      },
    };
  });
  const queue = new DriverOfflineQueue(
    store,
    transport,
    () => "command-journey-0001",
    () => new Date("2026-10-18T00:00:00Z"),
  );
  await queue.enqueuePickupJourneyAction(
    scope,
    "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
    "start_pickup",
    6,
  );
  assert.equal((await queue.flush()).remaining, 0);
  assert.match(requests[0]!.url, /actions\/start_pickup$/);
  assert.equal(requests[0]!.key, "driver-command:command-journey-0001");
  assert.deepEqual(JSON.parse(requests[0]!.body!), {
    tenantRef: "tenant:synthetic",
    branchRef: "branch:main",
    expectedVersion: 6,
  });
});

test("delivery confirmation queues only hash-bound synthetic POD metadata", async () => {
  const store = new MemoryStore();
  const requests: Array<{ body?: string }> = [];
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "synthetic-token", async (_url, init) => {
    requests.push({ ...(init.body ? { body: init.body } : {}) });
    return {
      ok: true,
      status: 200,
      async json() { return { state: "DELIVERED", version: 13 }; },
    };
  });
  const queue = new DriverOfflineQueue(
    store,
    transport,
    () => "command-pod-0001",
    () => new Date("2026-10-18T00:00:00Z"),
  );
  await queue.enqueueJourneyAction(
    scope,
    "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
    "deliver_with_pod",
    12,
    {
      pod: {
        evidenceRef: "synthetic-photo:queue-proof-0001",
        sha256: "b".repeat(64),
        contentType: "image/png",
        byteSize: 256,
        pixelWidth: 10,
        pixelHeight: 10,
        syntheticOnly: true,
      },
    },
  );
  assert.equal((await queue.flush()).remaining, 0);
  const body = JSON.parse(requests[0]!.body!) as Record<string, unknown>;
  assert.equal("otp" in body, false);
  assert.equal("signature" in body, false);
  assert.equal("bytes" in body, false);
  assert.deepEqual(body.pod, {
    evidenceRef: "synthetic-photo:queue-proof-0001",
    sha256: "b".repeat(64),
    contentType: "image/png",
    byteSize: 256,
    pixelWidth: 10,
    pixelHeight: 10,
    syntheticOnly: true,
  });
});

test("restart recovery reads the active assignment from the server", async () => {
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "synthetic-token", async (url) => {
    assert.match(url, /\/v1\/driver\/assignments\/current\?/);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          serverNow: "2026-10-18T00:01:00.000Z",
          assignment: {
            assignmentId: "b0cc82a3-a056-4600-b413-cc8d54894320",
            deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
            offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
            status: "ACTIVE",
            deliveryState: "ASSIGNED",
            deliveryVersion: 6,
            assignedAt: "2026-10-18T00:00:30.000Z",
          },
        };
      },
    };
  });
  const current = await transport.getCurrentAssignment(scope);
  assert.equal(current.assignment?.deliveryState, "ASSIGNED");
  assert.equal(current.assignment?.deliveryVersion, 6);
});

test("polling snapshot validates one coherent server view", async () => {
  const transport = new DriverHttpTransport("https://delivery.invalid", async () => "synthetic-token", async (url) => {
    assert.match(url, /\/v1\/driver\/snapshot\?/);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          serverNow: "2026-10-18T00:02:00.000Z",
          availability: { state: "BUSY", version: 3 },
          assignment: {
            assignmentId: "b0cc82a3-a056-4600-b413-cc8d54894320",
            deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
            offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
            status: "ACTIVE",
            deliveryState: "AT_PICKUP",
            deliveryVersion: 8,
            assignedAt: "2026-10-18T00:00:30.000Z",
          },
          offers: [],
        };
      },
    };
  });
  const snapshot = await transport.getSnapshot(scope);
  assert.equal(snapshot.availability?.state, "BUSY");
  assert.equal(snapshot.assignment?.deliveryState, "AT_PICKUP");
  assert.deepEqual(snapshot.offers, []);
});

test("privacy and money capabilities fail closed in the synthetic foundation", () => {
  assert.equal(Object.values(PHASE4_SAFE_CAPABILITIES).every((enabled) => enabled === false), true);
});
