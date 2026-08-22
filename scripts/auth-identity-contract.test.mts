import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateNewPassword,
  validateUsername,
} from "../apps/web/lib/auth/identity.ts";

test("username identity is case-insensitive and Unicode-normalized", () => {
  assert.equal(normalizeUsername(" Admin "), "admin");
  assert.equal(normalizeUsername("aDmin"), "admin");
  assert.equal(normalizeUsername("Ａｄｍｉｎ"), "admin");
  assert.equal(normalizeUsername("Somchai.User"), normalizeUsername("somchai.user"));
});

test("public registration rejects reserved and malformed usernames", () => {
  assert.deepEqual(validateUsername("Admin"), { ok: false, code: "RESERVED" });
  assert.deepEqual(validateUsername("ab"), { ok: false, code: "LENGTH" });
  assert.deepEqual(validateUsername("a..b"), { ok: false, code: "CONSECUTIVE" });
  assert.deepEqual(validateUsername("valid_user"), { ok: true, value: "valid_user" });
});

test("email identity is trimmed and case-insensitive", () => {
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.deepEqual(validateEmail(" User@Example.COM "), {
    ok: true,
    value: "user@example.com",
  });
  assert.equal(validateEmail("not-an-email").ok, false);
});

test("new passwords respect bcrypt's effective byte limit", () => {
  assert.deepEqual(validateNewPassword("short"), { ok: false, code: "TOO_SHORT" });
  assert.equal(validateNewPassword("correct horse battery staple").ok, true);
  assert.deepEqual(validateNewPassword("ก".repeat(25)), { ok: false, code: "TOO_LONG" });
});
