import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  assertLoopbackHttpOrigin,
  assertSyntheticTenantRef,
  buildLocalConfiguration,
  parseEnvText,
} from "./fleet-delivery-dev.js";

test("dev environment parsing builds loopback-only URLs without exposing secrets", () => {
  const values = parseEnvText(`
    # local only
    FLEET_DELIVERY_POSTGRES_DB=fleet_delivery
    FLEET_DELIVERY_POSTGRES_OWNER=fleet_delivery_owner
    FLEET_DELIVERY_POSTGRES_OWNER_PASSWORD='local-secret'
    FLEET_DELIVERY_POSTGRES_HOST_PORT=55432
    FLEET_DELIVERY_API_HOST_PORT=4100
  `);
  const configuration = buildLocalConfiguration(values);
  assert.equal(configuration.apiBaseUrl, "http://127.0.0.1:4100");
  const database = new URL(configuration.ownerDatabaseUrl);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.username, "fleet_delivery_owner");
  assert.equal(database.password, "local-secret");
  assert.equal(database.port, "55432");
});

test("dev environment refuses placeholders, remote API origins and duplicate keys", () => {
  assert.throws(() => buildLocalConfiguration(parseEnvText(`
    FLEET_DELIVERY_POSTGRES_DB=fleet_delivery
    FLEET_DELIVERY_POSTGRES_OWNER=fleet_delivery_owner
    FLEET_DELIVERY_POSTGRES_OWNER_PASSWORD=change-me-owner-local-only
  `)), /LOCAL_ENV_PLACEHOLDER/);
  assert.throws(() => assertLoopbackHttpOrigin("https://example.com"), /DEV_API_MUST_BE_LOOPBACK/);
  assert.throws(() => assertLoopbackHttpOrigin("http://localhost:4100"), /DEV_API_MUST_BE_LOOPBACK/);
  assert.throws(() => parseEnvText("A=1\nA=2"), /DUPLICATE_LOCAL_ENV_KEY/);
});

test("cleanup authority is restricted to the synthetic dev tenant prefix", () => {
  assert.doesNotThrow(() => assertSyntheticTenantRef("tenant:dev-123"));
  assert.throws(() => assertSyntheticTenantRef("tenant:production"), /CLEANUP_REFUSES_NON_SYNTHETIC/);
  assert.throws(() => assertSyntheticTenantRef(""), /CLEANUP_REFUSES_NON_SYNTHETIC/);
});

test("backup verification refuses the source database before invoking Docker", () => {
  const result = spawnSync("/bin/sh", ["infrastructure/fleet-delivery/scripts/verify-backup-restore.sh"], {
    env: {
      PATH: "/nonexistent",
      FLEET_DELIVERY_POSTGRES_DB: "fleet_delivery_restore_verify",
      FLEET_DELIVERY_POSTGRES_OWNER: "synthetic_owner",
      FLEET_DELIVERY_RESTORE_VERIFY_DB: "fleet_delivery_restore_verify",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must differ from the source/);
  assert.doesNotMatch(result.stderr, /docker|not found/);
});
