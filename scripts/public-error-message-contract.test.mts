// =============================================================
// Public routes show customers the service's own message, never a database or runtime error.
// -------------------------------------------------------------
// Signed checkout, board-game booking/payment/cancel and nearby search caught every error and
// returned `error.message` to anonymous callers, so a PostgreSQL error (constraint/column/type
// names) or a TypeError reached strangers verbatim. Found 2026-11-24 (REST sweep).
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicErrorMessage } from "../apps/web/lib/publicErrorMessage.ts";

test("domain messages pass through; database, system and runtime errors use the fallback", () => {
  assert.equal(publicErrorMessage(new Error("คำขอจองนี้หมดอายุแล้ว"), "FALLBACK"), "คำขอจองนี้หมดอายุแล้ว");
  const pg = Object.assign(new Error('duplicate key value violates unique constraint "bms_x_pkey"'),
    { severity: "ERROR", code: "23505", routine: "_bt_check_unique" });
  assert.equal(publicErrorMessage(pg, "FALLBACK"), "FALLBACK");
  assert.equal(publicErrorMessage(Object.assign(new Error('column "x" does not exist'), { code: "42703" }), "FALLBACK"), "FALLBACK");
  assert.equal(publicErrorMessage(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    { code: "ECONNREFUSED", errno: -4078, syscall: "connect" }), "FALLBACK"), "FALLBACK");
  assert.equal(publicErrorMessage(Object.assign(new Error("ลิงก์หมดอายุแล้ว"), { code: "EXPIRED" }), "FALLBACK"),
    "ลิงก์หมดอายุแล้ว", "a domain code that happens to start with E is still a domain message");
  assert.equal(publicErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), "FALLBACK"), "FALLBACK");
  assert.equal(publicErrorMessage("plain string", "FALLBACK"), "FALLBACK");
  assert.equal(publicErrorMessage(new Error("   "), "FALLBACK"), "FALLBACK");
});

const PUBLIC_ROUTES = [
  "app/api/bms/checkout/route.ts",
  "app/api/board-game/bookings/route.ts",
  "app/api/board-game/bookings/[token]/route.ts",
  "app/api/board-game/bookings/[token]/payment/route.ts",
  "app/api/board-game/nearby/route.ts",
];

test("anonymous public routes never echo a raw caught error message", () => {
  for (const route of PUBLIC_ROUTES) {
    const source = readFileSync(new URL(`../apps/web/${route}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/, route);
    assert.match(source, /publicErrorMessage\(error,/, route);
  }
});
