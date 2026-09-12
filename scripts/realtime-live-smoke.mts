// Local-only live proof: PostgreSQL trigger -> outbox pump -> Redis -> every WS instance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createClient } from "../apps/ws/node_modules/graphql-ws/lib/client.mjs";
import WebSocket from "../apps/ws/node_modules/ws/wrapper.mjs";

const host = process.env.POSTGRES_HOST ?? "";
assert.ok(
  ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host),
  `local test DB required, received ${host || "<unset>"}`,
);
process.env.POSTGRES_POOL_IDLE_TIMEOUT_MS ??= "1000";
const { query } = await import("../apps/web/lib/db");
const { issuePosDeviceToken, setCashierPin } = await import("../apps/web/lib/bms/pos");

const urls = (process.env.BMS_REALTIME_WS_URLS ?? "ws://127.0.0.1:8081/graphql")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
assert.ok(urls.length >= 2, "provide at least two BMS_REALTIME_WS_URLS for fan-out proof");
const webUrl = (process.env.BMS_REALTIME_WEB_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

class NativeWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, { headers: { "x-bms-client-class": "native" } });
  }
}

async function waitForWeb(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${webUrl}/api/graphql`, { method: "OPTIONS" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`web service did not become ready at ${webUrl}`);
}

const tenantId = randomUUID();
const locationId = randomUUID();
const deviceId = randomUUID();
const cashierId = randomUUID();
const marker = `live-${randomUUID()}`;
const clients: ReturnType<typeof createClient>[] = [];

try {
  await waitForWeb();
  await query("INSERT INTO bms_tenants(id, name, slug) VALUES($1, $2, $3)", [
    tenantId,
    "FAKE realtime live smoke",
    marker,
  ]);
  await query(
    `INSERT INTO bms_locations(id, tenant_id, code, name, branch_code, is_head_office)
     VALUES($1, $2, 'RTLIVE', 'Realtime live', 'RTLIVE', true)`,
    [locationId, tenantId],
  );
  await query(
    `INSERT INTO bms_pos_devices(id, tenant_id, location_id, code, name)
     VALUES($1, $2, $3, 'RT-LIVE', 'Realtime live register')`,
    [deviceId, tenantId, locationId],
  );
  await query(
    `INSERT INTO users(id, name, email, role, role_id, password_hash, fake_test, tenant_id)
     SELECT $1, 'Realtime live cashier', $2, 'Administrator', id, 'not-used', true, $3
       FROM roles WHERE name = 'Administrator' ORDER BY created_at LIMIT 1`,
    [cashierId, `${marker}@example.invalid`, tenantId],
  );
  await setCashierPin(tenantId, cashierId, "5137");
  const token = await issuePosDeviceToken(tenantId, deviceId);
  assert.ok(token?.token, "device token must be issued");

  async function graphqlRequest(queryText: string, variables?: Record<string, unknown>) {
    const response = await fetch(`${webUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.token}`,
        "x-pos-device-token": token.token,
        "x-scope": "pos",
      },
      body: JSON.stringify({ query: queryText, variables }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    return JSON.parse(responseText) as any;
  }

  const bootstrap = await graphqlRequest(`query LivePosBootstrap {
    bmsPosSession { device { id } location { id } cashiers { id hasPin } }
  }`);
  assert.equal(bootstrap.errors, undefined, JSON.stringify(bootstrap.errors));
  assert.equal(bootstrap.data?.bmsPosSession?.device?.id, deviceId);
  assert.equal(bootstrap.data?.bmsPosSession?.location?.id, locationId);
  assert.ok(bootstrap.data?.bmsPosSession?.cashiers?.some(
    (cashier: any) => cashier.id === cashierId && cashier.hasPin === true,
  ));

  const verified = await graphqlRequest(`mutation LiveVerifyCashier($input: BmsPosCredentialsInput!) {
    bmsPosVerifyCashier(input: $input) { id name role hasPin }
  }`, { input: { cashierUserId: cashierId, pin: "5137" } });
  assert.equal(verified.errors, undefined, JSON.stringify(verified.errors));
  assert.equal(verified.data?.bmsPosVerifyCashier?.id, cashierId);

  const ticketResponse = await fetch(
    `${webUrl}/api/bms/realtime/ticket?scope=pos`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.token}`,
        "x-pos-device-token": token.token,
      },
    },
  );
  const ticketText = await ticketResponse.text();
  assert.equal(ticketResponse.status, 200, ticketText);
  const ticketBody = JSON.parse(ticketText) as { ticket?: unknown };
  assert.equal(typeof ticketBody.ticket, "string", "HTTP route must mint a ticket");

  const connected: Array<Promise<void>> = [];
  const received = urls.map((url) => {
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      let connectedResolve!: () => void;
      connected.push(new Promise<void>((done) => { connectedResolve = done; }));
      const client = createClient({
        url,
        webSocketImpl: NativeWebSocket as any,
        retryAttempts: 0,
        connectionParams: { ticket: ticketBody.ticket as string },
        on: { connected: connectedResolve },
      });
      clients.push(client);
      client.subscribe(
        {
          query: `subscription LiveDeviceEvent {
            bmsDeviceSessionChanged { eventId eventType tenantId locationId deviceId entityId payload }
          }`,
        },
        {
          next(result) {
            const event = (result.data as any)?.bmsDeviceSessionChanged;
            if (event?.entityId === deviceId) resolve(event);
          },
          error: reject,
          complete() {},
        },
      );
    });
    // A dead instance may reject before Promise.all is reached; attach a handler immediately.
    void result.catch(() => undefined);
    return result;
  });

  await Promise.race([
    Promise.all(connected),
    new Promise((_, reject) => setTimeout(() => reject(new Error("WS connect timeout")), 10_000)),
  ]);

  await query(
    `SELECT public.bms_emit_realtime_event(
      'device.session.changed', $1, $2, NULL, 'pos_device', $3::text,
      NULL, now(), jsonb_build_object('status', 'ACTIVE'), $3::uuid
    )`,
    [tenantId, locationId, deviceId],
  );

  const events = await Promise.race([
    Promise.all(received),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("fan-out delivery timeout")), 15_000),
    ),
  ]);
  assert.equal(events.length, urls.length);
  assert.ok(events.every((event) => event.eventType === "device.session.changed"));

  const row = (await query<{ status: string }>(
    `SELECT status FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_id = $2
      ORDER BY id DESC LIMIT 1`,
    [tenantId, deviceId],
  )).rows[0];
  assert.equal(row?.status, "PUBLISHED", "dispatcher must acknowledge the outbox row");
  console.log(JSON.stringify({ ok: true, instances: urls.length, eventType: events[0].eventType }));
} finally {
  await Promise.allSettled(clients.map((client) => client.dispose()));
  await query("DELETE FROM bms_realtime_outbox WHERE tenant_id = $1", [tenantId]).catch(() => {});
  await query("DELETE FROM bms_pos_devices WHERE tenant_id = $1", [tenantId]).catch(() => {});
  await query("DELETE FROM users WHERE tenant_id = $1", [tenantId]).catch(() => {});
  await query("DELETE FROM bms_locations WHERE tenant_id = $1", [tenantId]).catch(() => {});
  await query("DELETE FROM bms_tenants WHERE id = $1", [tenantId]).catch(() => {});
}
