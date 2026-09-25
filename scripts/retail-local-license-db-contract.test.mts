import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { ingestRetailLocalLicenseEvidence } from "../apps/web/lib/bms/retailLocalLicensing.ts";

function evidence(input: {
  licenseCode: string;
  installationId: string;
  sequence: number;
  previousEventHash?: string;
  eventType?: string;
  keyPair?: ReturnType<typeof crypto.generateKeyPairSync>;
}) {
  const keyPair = input.keyPair ?? crypto.generateKeyPairSync("ed25519");
  const der = keyPair.publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = der.subarray(der.length - 32);
  const event = {
    formatVersion: 1 as const,
    eventId: crypto.randomUUID(),
    eventType: input.eventType ?? "RUNTIME_SEEN",
    licenseId: input.licenseCode,
    installationId: input.installationId,
    platformTarget: "ubuntu-24.04-lts-x64",
    releaseVersion: "1.0.0-test.1",
    agentVersion: "0.5.0",
    occurredAt: new Date().toISOString(),
    sequence: input.sequence,
    ...(input.previousEventHash ? { previousEventHash: input.previousEventHash } : {}),
    deviceKeyThumbprint: crypto.createHash("sha256").update(rawPublicKey).digest("hex"),
  };
  const bytes = Buffer.from(JSON.stringify(event));
  const envelope = {
    formatVersion: 1 as const,
    event,
    eventHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    devicePublicKey: rawPublicKey.toString("base64url"),
    signature: crypto.sign(null, bytes, keyPair.privateKey).toString("base64url"),
  };
  return { envelope, keyPair };
}

test("license ingestion stores an accepted chain and flags a second installation for human review", async (t) => {
  const licenseId = crypto.randomUUID();
  const licenseCode = `LIC-TEST-${crypto.randomBytes(8).toString("hex")}`;
  const token = `bmslt_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await query(
    `INSERT INTO bms_retail_local_licenses (id, license_code, max_active_installations) VALUES ($1,$2,1)`,
    [licenseId, licenseCode]
  );
  await query(
    `INSERT INTO bms_retail_local_license_tokens (license_id, token_hash) VALUES ($1,$2)`,
    [licenseId, tokenHash]
  );
  t.after(async () => {
    await query(`DELETE FROM bms_retail_local_license_reviews WHERE license_id = $1`, [licenseId]);
    await query(`DELETE FROM bms_retail_local_license_events WHERE license_id = $1`, [licenseId]);
    await query(`DELETE FROM bms_retail_local_license_installations WHERE license_id = $1`, [licenseId]);
    await query(`DELETE FROM bms_retail_local_license_tokens WHERE license_id = $1`, [licenseId]);
    await query(`DELETE FROM bms_retail_local_licenses WHERE id = $1`, [licenseId]);
  });

  const installationId = crypto.randomUUID();
  const first = evidence({ licenseCode, installationId, sequence: 1, eventType: "INSTALLATION_REGISTERED" });
  assert.deepEqual(await ingestRetailLocalLicenseEvidence(token, first.envelope), {
    accepted: true, duplicate: false, reviewRequired: false,
  });
  const second = evidence({
    licenseCode, installationId, sequence: 2, previousEventHash: first.envelope.eventHash,
    keyPair: first.keyPair,
  });
  assert.equal((await ingestRetailLocalLicenseEvidence(token, second.envelope)).reviewRequired, false);

  const duplicateInstall = evidence({
    licenseCode, installationId: crypto.randomUUID(), sequence: 1, eventType: "INSTALLATION_REGISTERED",
  });
  assert.equal((await ingestRetailLocalLicenseEvidence(token, duplicateInstall.envelope)).reviewRequired, true);
  const rows = await query<{ accepted: string; review: string }>(
    `SELECT
       count(*) FILTER (WHERE verification_status = 'ACCEPTED')::text AS accepted,
       count(*) FILTER (WHERE verification_status = 'REVIEW_REQUIRED')::text AS review
     FROM bms_retail_local_license_events WHERE license_id = $1`, [licenseId]
  );
  assert.deepEqual(rows.rows[0], { accepted: "2", review: "1" });
  const reviews = await query<{ reason: string }>(
    `SELECT reason FROM bms_retail_local_license_reviews WHERE license_id = $1 AND status = 'OPEN'`, [licenseId]
  );
  assert.equal(reviews.rows[0]?.reason, "ACTIVE_INSTALLATION_LIMIT");
});
