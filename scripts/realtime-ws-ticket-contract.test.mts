import assert from "node:assert/strict";
import test from "node:test";

import {
  REALTIME_TICKET_AUDIENCE,
  REALTIME_TICKET_VERSION,
  signRealtimeTicket,
  validateRealtimeTicketClaims,
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from "../packages/realtime/src/wsTicket.ts";

const secret = "test-only-realtime-ticket-secret-at-least-32-bytes";
const now = Math.floor(Date.now() / 1000);

function claims(overrides: Partial<RealtimeTicketClaims> = {}): RealtimeTicketClaims {
  return {
    version: REALTIME_TICKET_VERSION,
    audience: REALTIME_TICKET_AUDIENCE,
    ticketId: "11111111-1111-4111-8111-111111111111",
    scope: "admin",
    subjectId: "22222222-2222-4222-8222-222222222222",
    tenantId: "33333333-3333-4333-8333-333333333333",
    permissions: ["inbox.view", "order.view"],
    allLocations: true,
    locationIds: [],
    sessionId: "session_123",
    sessionVersion: 2,
    issuedAt: now,
    expiresAt: now + 60,
    ...overrides,
  };
}

test("signed ticket round-trips without cookies or client-selected scope", async () => {
  const ticket = await signRealtimeTicket(claims(), secret);
  assert.deepEqual(await verifyRealtimeTicket(ticket, secret, now), claims());
  assert.equal(ticket.split(".").length, 2);
});

test("ticket claims accept PostgreSQL UUIDs without requiring RFC version bits", () => {
  assert.doesNotThrow(() => validateRealtimeTicketClaims(claims({
    tenantId: "11111111-1111-1111-1111-111111111111",
  }), now));
  assert.throws(() => validateRealtimeTicketClaims(claims({
    tenantId: "not-a-uuid",
  }), now), /INVALID_TENANT_ID/);
});

test("tamper, expiry, excessive lifetime, and wrong audience fail closed", async () => {
  const ticket = await signRealtimeTicket(claims(), secret);
  await assert.rejects(() => verifyRealtimeTicket(`${ticket}x`, secret, now), /INVALID_TICKET_SIGNATURE/);
  await assert.rejects(() => verifyRealtimeTicket(ticket, secret, now + 61), /TICKET_EXPIRED/);
  assert.throws(() => validateRealtimeTicketClaims(claims({ expiresAt: now + 301 }), now), /TICKET_LIFETIME_TOO_LONG/);
  assert.throws(() => validateRealtimeTicketClaims({ ...claims(), audience: "another-service" }, now), /INVALID_AUDIENCE/);
});

test("admin tenant permissions require a trusted tenant and session", () => {
  assert.throws(() => validateRealtimeTicketClaims(claims({ tenantId: undefined }), now), /TENANT_REQUIRED/);
  assert.throws(() => validateRealtimeTicketClaims(claims({ sessionId: undefined }), now), /SESSION_REQUIRED/);
  assert.throws(() => validateRealtimeTicketClaims(claims({
    actingTenantId: "44444444-4444-4444-8444-444444444444",
  }), now), /ACTING_TENANT_MISMATCH/);
});

test("location scope and permission arrays are bounded and unique", () => {
  assert.doesNotThrow(() => validateRealtimeTicketClaims(claims({
    allLocations: true,
    locationIds: ["55555555-5555-4555-8555-555555555555"],
  }), now));
  assert.throws(() => validateRealtimeTicketClaims(claims({
    permissions: ["order.view", "order.view"],
  }), now), /INVALID_PERMISSIONS/);
});

test("POS tickets require one server-derived tenant, device and location scope", () => {
  const pos = claims({
    scope: "pos",
    sessionId: undefined,
    allLocations: false,
    locationIds: ["55555555-5555-4555-8555-555555555555"],
  });
  assert.doesNotThrow(() => validateRealtimeTicketClaims(pos, now));
  assert.throws(() => validateRealtimeTicketClaims({ ...pos, tenantId: undefined }, now), /POS_SCOPE_REQUIRED/);
  assert.throws(() => validateRealtimeTicketClaims({ ...pos, locationIds: [] }, now), /POS_SCOPE_REQUIRED/);
  assert.throws(() => validateRealtimeTicketClaims({ ...pos, allLocations: true }, now), /POS_SCOPE_REQUIRED/);
});
