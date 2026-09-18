import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateNewPassword,
  validateUsername,
} from "../apps/web/lib/auth/identity.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

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

test("login and registration buttons show progress and reject repeat submits", () => {
  const adminLogin = read("../apps/web/app/(admin)/admin/login/page.tsx");
  const publicLogin = read("../apps/web/components/auth/LoginClient.tsx");
  const loginForm = read("../apps/web/components/auth/LoginForm.tsx");
  const register = read("../apps/web/components/auth/RegisterClient.tsx");
  const shopSignup = read("../apps/web/app/(auth)/shop-signup/page.tsx");

  assert.match(adminLogin, /const busy = loadingLogin \|\| redirecting/);
  assert.match(adminLogin, /if \(submitting\.current\) return/);
  assert.match(adminLogin, /loading=\{busy\}[\s\S]{0,100}admin_login\.submitting/);
  assert.doesNotMatch(adminLogin, /const \[loading,\s*setLoading\]/);

  assert.match(publicLogin, /const busy = loading \|\| loadingSocial \|\| redirecting/);
  assert.match(publicLogin, /if \(submitting\.current\) return/);
  assert.match(publicLogin, /loading=\{busy\}[\s\S]{0,100}submittingLabel=\{strings\.submitting\}/);
  assert.match(loginForm, /disabled=\{loading\}[\s\S]{0,800}loading \? submittingLabel : submitLabel/);

  assert.match(register, /if \(submitting\.current\) return/);
  assert.match(register, /<Form[^>]+disabled=\{busy\}[^>]+aria-busy=\{busy\}/);
  assert.match(register, /loading=\{busy\}[\s\S]{0,100}strings\.submitting/);
  assert.match(shopSignup, /<Form[^>]+disabled=\{loading\}[^>]+aria-busy=\{loading\}/);
  assert.match(shopSignup, /loading=\{loading\}[\s\S]{0,120}shopSignup\.submitting/);
});
