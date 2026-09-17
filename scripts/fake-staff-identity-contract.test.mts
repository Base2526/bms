import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateFakeStaffIdentities,
  fakeStaffIdentity,
} from "../apps/web/lib/bms/fakeStaffIdentity";

test("all staff supported by the fake-data endpoint have distinct display names", () => {
  // POST /api/dev/fake/users caps one request at 200 accounts.  The POS PIN
  // screen displays this name (not the unique email), so uniqueness here is
  // what prevents separate fixtures from looking like duplicate database rows.
  const identities = Array.from({ length: 200 }, (_, index) => fakeStaffIdentity(index));

  assert.equal(new Set(identities.map((identity) => identity.name)).size, identities.length);
  assert.ok(identities.every((identity) => /^[a-z]+$/.test(identity.emailAlias)));
});

test("the default 44-person test shop keeps natural Thai names without counters", () => {
  const names = Array.from({ length: 44 }, (_, index) => fakeStaffIdentity(index).name);

  assert.ok(names.every((name) => /^\S+ \S+$/.test(name)), names.join("\n"));
  assert.ok(names.every((name) => !/\d/.test(name)), names.join("\n"));
});

test("a later seed request skips display names already used by fake staff", () => {
  const firstRun = allocateFakeStaffIdentities(50, []);
  const secondRun = allocateFakeStaffIdentities(50, firstRun.map((identity) => identity.name));
  const allNames = [...firstRun, ...secondRun].map((identity) => identity.name);

  assert.equal(new Set(allNames).size, allNames.length);
});

test("fake staff identities remain unique after all natural name combinations", () => {
  const names = Array.from({ length: 900 }, (_, index) => fakeStaffIdentity(index).name);

  assert.equal(new Set(names).size, names.length);
});

test("invalid fake staff indexes fail loudly", () => {
  assert.throws(() => fakeStaffIdentity(-1), /non-negative integer/);
  assert.throws(() => fakeStaffIdentity(1.5), /non-negative integer/);
});
