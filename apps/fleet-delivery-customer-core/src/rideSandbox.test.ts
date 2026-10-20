import assert from "node:assert/strict";
import test from "node:test";
import {
  RideSandboxClient,
  RideRequestError,
  rideRequest,
  type PendingRideCommand,
} from "./rideSandbox.js";
import type { RideSession } from "@bms/fleet-delivery-contracts";
const session: RideSession = {
  accountId: "00000000-0000-4000-8000-000000000001",
  apiBaseUrl: "http://127.0.0.1:4200",
  accessToken: "a".repeat(64),
  expiresAt: "2099-01-01T00:00:00Z",
  role: "DRIVER",
};
test("location is ephemeral: never persisted or retried through durable business commands",async()=>{
  const original=globalThis.fetch;
  let saves=0;
  const client=new RideSandboxClient(session,{load:async()=>null,save:async()=>{saves++;}});
  const fix={lat:13.7463,lng:100.5347,accuracyM:5,capturedAt:new Date().toISOString(),source:"SIMULATOR" as const};
  const sent: unknown[]=[];
  try {
    globalThis.fetch=async(url,init)=>{
      assert.ok(String(url).endsWith('/sandbox/location'));
      assert.equal((init!.headers as Record<string,string>)['idempotency-key'],undefined);
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ok:true}));
    };
    await client.location(fix);await client.location(null);
    assert.deepEqual(sent,[fix,null]);assert.equal(saves,0);
    await assert.rejects(()=>client.command('location',fix));
    assert.equal(saves,0);
  } finally {globalThis.fetch=original;}
});
test("ride commands persist before send, replay same key after lost response/restart, reject double taps", async () => {
  const original = globalThis.fetch;
  let pending: PendingRideCommand | null = null;
  const store = {
    load: async () => pending,
    save: async (value: PendingRideCommand | null) => {
      pending = value;
    },
  };
  const keys: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(pending, "Durable before I/O");
      keys.push((init!.headers as Record<string, string>)["idempotency-key"]!);
      throw new Error("RESPONSE_LOST");
    };
    const client = new RideSandboxClient(session, store);
    await assert.rejects(
      () => client.command("availability", { online: true }),
      /RESPONSE_LOST/
    );
    assert.ok(pending);
    await assert.rejects(
      () => client.command("availability", { online: false }),
      /RETRY_PENDING_COMMAND_FIRST/
    );
    globalThis.fetch = async (_url, init) => {
      keys.push((init!.headers as Record<string, string>)["idempotency-key"]!);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const restarted = new RideSandboxClient(session, store);
    const retry = restarted.retry();
    await assert.rejects(() => restarted.retry(), /COMMAND_PENDING/);
    assert.deepEqual(await retry, { ok: true });
    assert.equal(pending, null);
    assert.equal(keys[0], keys[1]);
  } finally {
    globalThis.fetch = original;
  }
});
test("ride definitive conflict clears pending; expired auth and server failures retain it; unsafe origin denied", async () => {
  const original = globalThis.fetch;
  let pending: PendingRideCommand | null = null;
  const store = {
    load: async () => pending,
    save: async (value: PendingRideCommand | null) => {
      pending = value;
    },
  };
  try {
    const client = new RideSandboxClient(session, store);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: "STALE_TRIP_REFRESH" } }), {
        status: 409,
      });
    await assert.rejects(
      () => client.command("availability", { online: true }),
      RideRequestError
    );
    assert.equal(pending, null);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED" } }), {
        status: 401,
      });
    await assert.rejects(
      () => client.command("availability", { online: true }),
      RideRequestError
    );
    assert.ok(pending);
    await assert.rejects(() =>
      rideRequest("http://remote.example:4200", "register", undefined, {})
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("quote provider failure clears only the pre-write pending quote so the rider can choose new points", async () => {
  const original = globalThis.fetch;
  let pending: PendingRideCommand | null = null;
  const store = {
    load: async () => pending,
    save: async (value: PendingRideCommand | null) => {
      pending = value;
    },
  };
  try {
    const client = new RideSandboxClient(session, store);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "GOOGLE_ROUTES_UNAVAILABLE" } }),
        { status: 502 },
      );
    await assert.rejects(
      () =>
        client.command("quotes", {
          pickup: { label: "Siam", lat: 13.7463, lng: 100.5347 },
          dropoff: { label: "Asok", lat: 13.7372, lng: 100.5602 },
          providerConsent: true,
        }),
      RideRequestError,
    );
    assert.equal(pending, null);

    await assert.rejects(
      () => client.command("availability", { online: true }),
      RideRequestError,
    );
    assert.ok(pending, "unrelated 5xx commands remain retryable with the same key");
  } finally {
    globalThis.fetch = original;
  }
});
