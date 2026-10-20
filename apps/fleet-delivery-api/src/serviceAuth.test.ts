import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createServiceTokenVerifier, ServiceAuthError } from "./serviceAuth.js";

async function fixture(scopes = ["events.ingest"]) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "EdDSA";
  const token = await new SignJWT({ scopes })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key-1" })
    .setIssuer("synthetic-bms")
    .setAudience("fleet-delivery")
    .setSubject("bms-adapter-test")
    .setJti("token-test-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, publicJwk };
}

test("service verifier enforces audience, scope, and revocation", async () => {
  const { token, publicJwk } = await fixture();
  const verifier = createServiceTokenVerifier({
    jwks: { keys: [publicJwk] },
    issuer: "synthetic-bms",
    audience: "fleet-delivery",
    isRevoked: async () => false,
  });
  assert.equal((await verifier(`Bearer ${token}`, "events.ingest")).subject, "bms-adapter-test");
  await assert.rejects(() => verifier(`Bearer ${token}`, "events.publish"), (error: unknown) => {
    return error instanceof ServiceAuthError && error.code === "AUTH_FORBIDDEN";
  });
  await assert.rejects(() => verifier(undefined, "events.ingest"), (error: unknown) => {
    return error instanceof ServiceAuthError && error.code === "AUTH_REQUIRED";
  });

  const revoked = createServiceTokenVerifier({
    jwks: { keys: [publicJwk] },
    issuer: "synthetic-bms",
    audience: "fleet-delivery",
    isRevoked: async () => true,
  });
  await assert.rejects(() => revoked(`Bearer ${token}`, "events.ingest"), (error: unknown) => {
    return error instanceof ServiceAuthError && error.code === "AUTH_REVOKED";
  });
});
